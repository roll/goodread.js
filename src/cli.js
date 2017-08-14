const fs = require('fs')
const vm = require('vm')
const glob = require('glob')
const chalk = require('chalk')
const yaml = require('js-yaml')
const lodash = require('lodash')
const emojify = require('node-emoji').emojify


// Helpers

async function parseSpecs(path) {

  // Paths
  let paths = []
  if (path) {
    if (fs.existsSync(path)) {
      const stats = fs.statSync(path)
      if (stats.isFile()) {
        paths = [path]
      } else if (stats.isDirectory()) {
        paths = glob.sync(`${path}//*.*`)
      }
    }
  } else {
    if (paths.length === 0) {
      paths = glob.sync('packspec.*')
    }
    if (paths.length === 0) {
      paths = glob.sync('packspec/*.*')
    }
    if (paths.length === 0) {
      paths = ['README.md']
    }
  }

  // Specs
  const specs = []
  for (const path of paths) {
    let spec = null
    if (path.endsWith('.yml')) {
      spec = await parseSpecYml(path)
    } else if (path.endsWith('.md')) {
      spec = await parseSpecMd(path)
    } else if (path.endsWith('.js')) {
      spec = await parseSpecJs(path)
    }
    if (spec) {
      specs.push(spec)
    }
  }

  return specs
}


async function parseSpecYml(path) {

  // Package
  const documents = []
  const contents = fs.readFileSync(path, 'utf8')
  yaml.safeLoadAll(contents, doc => documents.push(doc))
  const firstFeature = await parseFeatureYml(documents[0][0])
  if (firstFeature.skip) return null
  const packname = firstFeature.comment

  // Features
  let skip = false
  const features = []
  for (let feature of documents[0]) {
    feature = await parseFeatureYml(feature)
    features.push(feature)
    if (feature.comment) {
      skip = feature.skip
    }
    feature.skip = skip || feature.skip
  }

  // Scope
  const scope = {}
  scope.$import = require
  if (documents.length > 1 && documents[1].js) {
    const userScope = {require}
    vm.runInContext(documents[1].js, vm.createContext(userScope))
    for (const [name, value] of Object.entries(userScope)) {
      scope[`$${name}`] = value
    }
  }

  // Stats
  const stats = {features: 0, comments: 0, skipped: 0, tests: 0}
  for (const feature of features) {
    stats.features += 1
    if (feature.comment) {
      stats.comments += 1
    } else {
      stats.tests += 1
      if (feature.skip) {
        stats.skipped += 1
      }
    }
  }

  return {type: 'abstract', package: packname, features, scope, stats}
}


async function parseSpecMd(path) {

  // Package
  const contents = fs.readFileSync(path, 'utf8').toString()
  const lines = contents.split('\n').map(line => `${line}\n`)
  const packname = lines[0].slice(1).trim()

  // Blocks
  let code = ''
  const blocks = []
  let capture = false
  for (const line of lines) {
    if (line.startsWith('```js')) {
      capture = true
      code = ''
      continue
    }
    if (line.startsWith('```')) {
      capture = false
      blocks.push(['code', code])
    }
    if (capture) {
      code += line
      continue
    }
    if (line.startsWith('#')) {
      const comment = line.slice(1).trim()
      blocks.push(['comment', comment])
    }
  }

  // Features
  const features = []
  for (const [type, block] of blocks) {
    if (type === 'comment') {
      features.push({comment: block})
      continue
    }
    for (const [index, line] of block.split('\n').entries()) {
      const lineNumber = index + 1
      if (line) {
        features.push({lineNumber, line, block})
      }
    }
  }

  // Stats
  const stats = {features: 0, comments: 0, skipped: 0, tests: 0}
  for (const feature of features) {
    stats.features += 1
    if (feature.comment) {
      stats.comments += 1
    } else {
      stats.tests += 1
    }
  }

  return {type: 'native', package: packname, features, scope: {require}, stats}

}


async function parseSpecJs(path) {

  // Package
  const contents = fs.readFileSync(path, 'utf8').toString()
  const lines = contents.split('\n').map(line => `${line}\n`)
  const packname = lines[0].slice(2).trim()

  // Blocks
  let code = ''
  const blocks = []
  for (const line of lines) {
    if (!line.trim()) continue
    if (line.startsWith('//')) {
      const comment = line.slice(2).trim()
      if (code) {
        blocks.push(['code', code])
        code = ''
      }
      blocks.push(['comment', comment])
      continue
    }
    code += line
  }
  if (code) {
    blocks.push(['code', code])
  }

  // Features
  const features = []
  for (const [type, block] of blocks) {
    if (type === 'comment') {
      features.push({comment: block})
      continue
    }
    for (const [index, line] of block.split('\n').entries()) {
      const lineNumber = index + 1
      if (line) {
        features.push({lineNumber, line, block})
      }
    }
  }

  // Stats
  const stats = {features: 0, comments: 0, skipped: 0, tests: 0}
  for (const feature of features) {
    stats.features += 1
    if (feature.comment) {
      stats.comments += 1
    } else {
      stats.tests += 1
    }
  }

  return {type: 'native', package: packname, features, scope: {require}, stats}

}


async function parseFeatureYml(feature) {

  // General
  if (lodash.isString(feature)) {
    const match = /^(?:\((.*)\))?(\w.*)?$/g.exec(feature)
    let [skip, comment] = match.slice(1)
    if (skip) {
      skip = !skip.split('|').includes('js')
    }
    return {assign: null, comment, skip}
  }
  let [left, right] = Object.entries(feature)[0]

  // Left side
  let call = false
  left = left.replace(/(_.)/g, match => match[1].toUpperCase())
  const match = /^(?:\((.*)\))?(?:([^=]*)=)?([^=].*)?$/g.exec(left)
  let [skip, assign, property] = match.slice(1)
  if (skip) {
    skip = !skip.split('|').includes('js')
  }
  if (!assign && !property) {
    throw new Error('Non-valid feature')
  }
  if (property) {
    call = true
    if (property.endsWith('==')) {
      property = property.slice(0, -2)
      call = false
    }
  }

  // Right side
  let args = []
  let kwargs = {}
  let result = right
  if (call) {
    result = null
    for (const item of right) {
      if (lodash.isPlainObject(item) && lodash.size(item) === 1) {
        let [itemLeft, itemRight] = Object.entries(item)[0]
        if (itemLeft === '==') {
          result = itemRight
          continue
        }
        if (itemLeft.endsWith('=')) {
          kwargs[itemLeft.slice(0, -1)] = itemRight
          continue
        }
      }
      args.push(item)
    }
  }

  // Text repr
  let text = property
  if (assign) {
    text = `${assign} = ${property || JSON.stringify(result)}`
  }
  if (call) {
    const items = []
    for (const item of args) {
      items.push(JSON.stringify(item))
    }
    for (const [name, item] of Object.entries(kwargs)) {
      items.push(`${name}=${JSON.stringify(item)}`)
    }
    text = `${text}(${items.join(', ')})`
  }
  if (result && !assign) {
    text = `${text} == ${(result !== 'ERROR') ? JSON.stringify(result) : result}`
  }
  text = text.replace(/{"([^{}]*?)":null}/g, '$1')

  return {comment: null, skip, call, assign, property, args, kwargs, result, text}
}


async function testSpecs(specs) {

  // Message
  let message = emojify('\n #  ')
  message += chalk.bold('JavaScript\n')
  console.log(message)

  // Test specs
  let success = true
  for (const spec of specs) {
    let specSuccess = true
    if (spec.type === 'abstract') {
      specSuccess = await testSpecAbstract(spec)
    } else {
      specSuccess = await testSpecNative(spec)
    }
    success = success && specSuccess
  }

  return success
}


async function testSpecAbstract(spec) {

  // Message
  console.log(emojify(':heavy_minus_sign::heavy_minus_sign::heavy_minus_sign:'))

  // Test spec
  let passed = 0
  for (const feature of spec.features) {
    passed += await testFeatureAbstract(feature, spec.scope)
  }
  const success = (passed === spec.stats.features)

  // Message
  let color = 'green'
  let message = chalk.green.bold(emojify('\n :heavy_check_mark:  '))
  if (!success) {
    color = 'red'
    message = chalk.red.bold(emojify('\n :x:  '))
  }
  message += chalk[color].bold(`${spec.package}: ${passed - spec.stats.comments - spec.stats.skipped}/${spec.stats.tests - spec.stats.skipped}\n`)
  console.log(message)

  return success
}


async function testSpecNative(spec) {

  // Message
  console.log(emojify(':heavy_minus_sign::heavy_minus_sign::heavy_minus_sign:'))

  // Test spec
  let passed = 0
  let success = true
  let exception = null
  let exceptionLine = null
  for (const feature of spec.features) {

    // Comment
    if (feature.comment) {
      let message = emojify('\n #  ')
      message += chalk.bold(`${feature.comment}\n`)
      console.log(message)
      passed += 1
      continue
    }

    // Execute
    if (feature.lineNumber === 1) {
      exceptionLine = null
      try {
        vm.runInContext(feature.block, vm.createContext(spec.scope))
      } catch (exc) {
        console.log(exc)
        success = false
        exception = exc
        exceptionLine = 1
      }
    }

    // Message
    if (!exceptionLine || feature.lineNumber < exceptionLine) {
      let message = chalk.green(emojify(' :heavy_check_mark:  '))
      message += `${feature.line}`
      console.log(message)
      passed += 1
    } else if (feature.lineNumber === exceptionLine) {
      let message = chalk.red(emojify(' :x:  '))
      message += `${feature.line}\n`
      message += chalk.red.bold(`Exception: ${exception}`)
      console.log(message)
    } else if (feature.lineNumber > exceptionLine) {
      let message = chalk.yellow(emojify(' :heavy_minus_sign:  '))
      message += `${feature.line}`
      console.log(message)
    }

  }

  // Message
  let color = 'green'
  let message = chalk.green.bold(emojify('\n :heavy_check_mark:  '))
  if (!success) {
    color = 'red'
    message = chalk.red.bold(emojify('\n :x:  '))
  }
  message += chalk[color].bold(`${spec.package}: ${passed - spec.stats.comments - spec.stats.skipped}/${spec.stats.tests - spec.stats.skipped}\n`)
  console.log(message)

  return success

}


async function testFeatureAbstract(feature, scope) {

  // Comment
  if (feature.comment) {
    let message = emojify('\n #  ')
    message += chalk.bold(`${feature.comment}\n`)
    console.log(message)
    return true
  }

  // Skip
  if (feature.skip) {
    let message = chalk.yellow(emojify(' :heavy_minus_sign:  '))
    message += `${feature.text}`
    console.log(message)
    return true
  }

  // Dereference
  feature = lodash.cloneDeep(feature)
  if (feature.call) {
    feature.args = dereferenceValue(feature.args, scope)
    feature.kwargs = dereferenceValue(feature.kwargs, scope)
  }
  feature.result = dereferenceValue(feature.result, scope)

  // Execute
  let exception = null
  let result = feature.result
  if (feature.property) {
    try {
      let owner = scope
      const names = feature.property.split('.')
      const lastName = names[names.length - 1]
      for (const name of names.slice(0, -1)) {
        owner = owner[name]
      }
      const property = owner[lastName]
      if (feature.call) {
        const firstLetter = (lastName[0] !== '$') ? lastName[0] : lastName[1]
        const args = [...feature.args]
        if (lodash.size(feature.kwargs)) {
          args.push(feature.kwargs)
        }
        if (firstLetter === firstLetter.toUpperCase()) {
          result = await new property(...args)
        } else {
          result = await property.bind(owner)(...args)
        }
      } else {
        result = property
      }
    } catch (exc) {
      exception = exc
      result = 'ERROR'
    }
  }

  // Assign
  if (feature.assign) {
    let owner = scope
    const names = feature.assign.split('.')
    const lastName = names[names.length - 1]
    for (const name of names.slice(0, -1)) {
      owner = owner[name]
    }
    if (owner[lastName] !== undefined && !parseInt(lastName, 10) && lastName === lastName.toUpperCase()) {
      throw new Error(`Can't update the constant ${lastName}`)
    }
    owner[lastName] = result
  }

  // Compare
  const success = (feature.result !== null) ? lodash.isEqual(result, feature.result) : result !== 'ERROR'
  if (success) {
    let message = chalk.green(emojify(' :heavy_check_mark:  '))
    message += `${feature.text}`
    console.log(message)
  } else {
    let message = chalk.red(emojify(' :x:  '))
    message += `${feature.text}\n`
    if (exception) {
      message += chalk.red.bold(`Exception: ${exception}`)
    } else {
      message += chalk.red.bold(`Assertion: ${JSON.stringify(result)} != ${JSON.stringify(feature.result)}`)
    }
    console.log(message)
  }

  return success
}


function dereferenceValue(value, scope) {
  value = lodash.cloneDeep(value)
  if (lodash.isPlainObject(value) && lodash.size(value) === 1 && Object.values(value)[0] === null) {
    let result = scope
    for (const name of Object.keys(value)[0].split('.')) {
      result = result[name]
    }
    value = result
  } else if (lodash.isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      value[key] = dereferenceValue(value[key], scope)
    }
  } else if (lodash.isArray(value)) {
    for (const index in value) {
      value[index] = dereferenceValue(value[index], scope)
    }
  }
  return value
}


// Main program

let argv = [...process.argv]
if (argv[0].endsWith('node')) {
  argv = argv.slice(1)
}
const path = argv[1] || null
parseSpecs(path).then(specs => {
  testSpecs(specs).then(success => {
    if (!success) process.exit(1)
  })
})
