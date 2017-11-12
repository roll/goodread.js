const fs = require('fs')
const axios = require('axios')
const {spawn} = require('child_process')
const helpers = require('./helpers')


// Module API

class DocumentList {

  // Public

  constructor(paths, config) {
    this._documents = []
    paths = paths.length ? paths : config.documents.map(item => item.main)
    paths = paths.length ? paths : ['README.md']
    for (const path of paths) {
      const mainPath = path
      let editPath = null
      let syncPath = null
      for (const item of config.documents) {
        if (path === item.main) {
          editPath = item.edit
          syncPath = item.sync
          break
        }
      }
      const document = new Document(mainPath, {editPath, syncPath})
      this._documents.push(document)
    }
  }

  async edit() {
    for (const document of this._documents) {
      await document.edit()
    }
  }

  async sync() {
    let success = true
    for (const document of this._documents) {
      const valid = document.test({sync: true})
      success = success && valid
      if (valid) {
        await document.sync()
      }
    }
    return success
  }

  async test({exitFirst}) {
    let success = true
    for (const [index, document] of this._documents.entries()) {
      const number = index + 1
      const valid = await document.test({exitFirst})
      success = success && valid
      helpers.printMessage(null, number < this._documents.length ? 'separator' : 'blank')
    }
    return success
  }

}


class Document {

  // Public

  constructor(mainPath, {editPath, syncPath}) {
    this._mainPath = mainPath
    this._editPath = editPath
    this._syncPath = syncPath
  }

  async edit() {

    // No edit path
    if (!this._editPath) {
      return
    }

    // Check synced
    if (this._mainPath !== this._editPath) {
      const mainContents = await loadDocument(this._mainPath)
      const syncContents = await loadDocument(this._syncPath)
      if (mainContents !== syncContents) {
        throw new Error(`Document "${this._editPath}" is out of sync`)
      }
    }

    // Remote document
    if (this._editPath.startsWith('http')) {
      spawn('xdg-open', [this._editPath])

    // Local document
    } else {
      spawn('editor', [this._editPath])
    }
  }

  async sync() {

    // No sync path
    if (!this._syncPath) {
      return
    }

    // Save remote to local
    const contents = await loadDocument(this._syncPath)
    fs.writeFileSync(this._mainPath, contents)
  }

  async test({sync, returnReport, exitFirst}) {

    // No test path
    const path = sync ? this._syncPath : this._mainPath
    if (!path) {
      return true
    }

    // Test document
    const contents = await loadDocument(path)
    const elements = await parseDocument(contents)
    const report = await validateDocument(elements, {exitFirst})

    return returnReport ? report : report.valid
  }

}


// Internal

async function loadDocument(path) {

  // Remote document
  if (path.startsWith('http')) {
    return (await axios.get(path)).data

  // Local document
  } else {
    return fs.readFileSync(path, 'utf-8')
  }

}


async function parseDocument(contents) {
  const elements = []
  let codeblock = ''
  let capture = false

  // Parse file lines
  for (const line of contents.split('\n')) {

    // Heading
    if (line.startsWith('#')) {
      const heading = line.trim().replace(/#/g, '').trim()
      const level = line.length - line.replace(/#/g, '').length
      if (elements.length &&
            elements[elements.length - 1].type === 'heading' &&
            elements[elements.length - 1].level === level) {
        continue
      }
      elements.push({
        type: 'heading',
        value: heading,
        level,
      })
    }

    // Codeblock
    if (line.startsWith('```javascript')) {
      if (line.includes('goodread')) {
        capture = true
      }
      codeblock = ''
      continue
    }
    if (line.startsWith('```')) {
      if (capture) {
        elements.push({
          type: 'codeblock',
          value: codeblock,
        })
      }
      capture = false
    }
    if (capture) {
      codeblock += `${line}\n`
      continue
    }

  }

  return elements

}


async function validateDocument(elements, {exitFirst}) {
  const scope = {}
  let passed = 0
  let failed = 0
  let skipped = 0
  let title = null
  let exception = null
  let exceptionLine = null

  // Test elements
  for (const element of elements) {

    // Heading
    if (element.type === 'heading') {
      helpers.printMessage(element.value, 'heading', {level: element.level})
      if (!title) {
        title = element.value
        helpers.printMessage(null, 'separator')
      }

    // Codeblock
    } else if (element.type === 'codeblock') {
      [exception, exceptionLine] = await helpers.runCodeblock(element.value, scope)
      const lines = element.value.trim().split('\n')
      for (const [index, line] of lines.entries()) {
        const lineNumber = index + 1
        if (lineNumber < exceptionLine) {
          helpers.printMessage(line, 'success')
          passed += 1
        } else if (lineNumber === exceptionLine) {
          helpers.printMessage(line, 'failure', {exception})
          if (exitFirst) {
            helpers.printMessage(scope, 'scope')
            throw exception
          }
          failed += 1
        } else if (lineNumber > exceptionLine) {
          helpers.printMessage(line, 'skipped')
          skipped += 1
        }
      }
    }

  }

  // Print summary
  if (title) {
    helpers.printMessage(title, 'summary', {passed, failed, skipped})
  }

  return {
    valid: !exception,
    passed,
    failed,
    skipped,
  }
}


// System

module.exports = {
  DocumentList,
}
