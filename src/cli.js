const helpers = require('./helpers')
const {DocumentList} = require('./document')


// Main program

async function main() {

  // Parse
  const paths = []
  let edit = false
  let sync = false
  let exitFirst = false
  const argv = [...process.argv]
  for (const arg of argv[0].endsWith('node') ? argv.slice(2) : argv.slice(1)) {
    if (['-e', '--edit'].includes(arg)) {
      edit = true
    } else if (['-s', '--sync'].includes(arg)) {
      sync = true
    } else if (['-x', '--exit-first'].includes(arg)) {
      exitFirst = true
    } else {
      paths.push(arg)
    }
  }

  // Prepare
  const config = helpers.readConfig()
  const documents = new DocumentList(paths, config)

  // Edit
  if (edit) {
    await documents.edit()

  // Sync
  } else if (sync) {
    await documents.sync()

  // Test
  } else {
    const success = await documents.test({exitFirst})
    if (!success) {
      process.exit(1)
    }
  }

}

main().catch(error => console.log(error))
