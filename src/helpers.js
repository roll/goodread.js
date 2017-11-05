const fs = require('fs')
const vm = require('vm')
const chalk = require('chalk')
const yaml = require('js-yaml')
const {assert} = require('chai')
const lodash = require('lodash')
const esprima = require('esprima')
const emojify = require('node-emoji').emojify
const state = {lastMessageType: null}


// Module API

function readConfig() {
  let config = {documents: ['README.md']}
  if (fs.existsSync('goodread.yml')) {
    config = yaml.safeLoad(fs.readFileSync('goodread.yml', 'utf8'))
  }
  for (const [index, document] of config.documents.entries()) {
    if (lodash.isPlainObject(document)) {
      if (!document.main) {
        throw new Error('Document requires "main" property')
      }
    }
    if (lodash.isString(document)) {
      config.documents[index] = {main: document}
    }
  }
  return config
}


function runCodeblock(codeblock, scope) {
  const names = []
  const ast = esprima.parse(`async function main() {${codeblock}}`)
  for (const item of ast.body[0].body.body) {
    if (!item.declarations) continue
    for (const declaration of item.declarations) {
      names.push(declaration.id.name)
    }
  }
  const lines = []
  for (let line of codeblock.trim().split('\n')) {
    if (line.includes(' // ')) {
      let [left, right] = line.split(' // ')
      left = left.trim()
      right = right.trim()
      if (left && right) {
        const message = `${left} != ${right}`
        line = `_assert.deepEqual(${left}, ${right}, '${message}')`
      }
    }
    lines.push(line)
  }
  return new Promise((resolve, reject) => {
    let codeblock = 'async function main() {'
    for (const line of lines) codeblock += `${line}\n`
    for (const name of names) codeblock += `_exports.${name} = ${name}\n`
    codeblock += '}\n'
    codeblock += `main()
        .then(result => {
          const exception = null
          const exceptionLine = 1000 // infinity
          Object.assign(_scope, _exports)
          _resolve([exception, exceptionLine])
        })
        .catch(error => {
          const exception = error
          const exceptionLine = parseInt(/evalmachine.*?:([0-9]+):[0-9]+/g.exec(error.stack)[1])
          Object.assign(_scope, _exports)
          _resolve([exception, exceptionLine])
      })`
    vm.runInContext(codeblock, vm.createContext({
      ...scope,
      require,
      console,
      _exports: {},
      _assert: assert,
      _resolve: resolve,
      _scope: scope,
    }))
  })
}


function printMessage(message, type, {level, exception, passed, failed, skipped}={}) {
  let text = ''
  if (type === 'blank') {
    return console.log('')
  } else if (type === 'separator') {
    text = ':heavy_minus_sign:'.repeat(3)
  } else if (type === 'heading') {
    text = ` ${'#'.repeat(level)} ${chalk.bold(message)}`
  } else if (type === 'success') {
    text = ` ${chalk.green(':heavy_check_mark:')}  ${message}`
  } else if (type === 'failure') {
    text = ` ${chalk.red(':x:')}  ${message}`
    text += chalk.red.bold(`\nException: ${exception}`)
  } else if (type === 'scope') {
    text += '---\n\n'
    text += 'Scope (current execution scope):\n'
    text += `[${Object.keys(message).map(key => `'${key}'`).join(', ')}]\n`
    text += '\n---\n'
  } else if (type === 'skipped') {
    text = ` ${chalk.yellow(':heavy_minus_sign:')}  ${message}`
  } else if (type === 'summary') {
    let color = 'green'
    text = chalk.green.bold(' :heavy_check_mark:  ')
    if ((failed + skipped) > 0) {
      color = 'red'
      text = chalk.red.bold(' :x:  ')
    }
    text += chalk[color].bold(`${message}: ${passed}/${passed + failed + skipped}`)
  }
  if (['success', 'failure', 'skipped'].includes(type)) {
    type = 'test'
  }
  if (text) {
    if (state.lastMessageType !== type) {
      text = '\n' + text
    }
    console.log(emojify(text))
  }
  state.lastMessageType = type
}


// System

module.exports = {
  readConfig,
  runCodeblock,
  printMessage,
}
