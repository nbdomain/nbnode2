/**
 * index.js
 *
 * Entry point
 */

const Indexer = require('./indexer')
const Server = require('./server')
const Database = require('./database')
const { Nodes } = require('./nodes')
const CONSTS = require('./const')
const Parser = require('./parser')

const Planaria = require('./planaria')
//const UrChain = require('./urchain')
//const RunConnectFetcher = require('./run-connect')
//const BitcoinNodeConnection = require('./bitcoin-node-connection')
const parseArgs = require('minimist')
const fs = require('fs')
const AWNode = require('./arapi')
//const BitcoinRpc = require('./bitcoin-rpc')
//const BitcoinZmq = require('./bitcoin-zmq')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const logger = console
logger.info("PLANARIA_TOKEN:", CONSTS.PLANARIA_TOKEN);
var myArgs = process.argv.slice(2);
let REORG = 0;
if (myArgs) {
  var argv = parseArgs(myArgs, opts = {})
  logger.info("cmd:", argv);
  if (argv.reorg) {
    REORG = argv.reorg
    fs.unlinkSync(__dirname + "/db/" + CONSTS.DMDB)
  }
}


// ------------------------------------------------------------------------------------------------
// main
// ------------------------------------------------------------------------------------------------
let indexers = null, server = null;
let apiAR = null, apiBSV = null;
class Indexers {
  static initDB() {
    this.db = new Database(__dirname + "/db/" + CONSTS.TXDB, __dirname + "/db/" + CONSTS.DMDB, logger)
    this.db.open()
  }
  static init() {

    switch (CONSTS.API.bsv) {
      case 'planaria': apiBSV = new Planaria(CONSTS.PLANARIA_TOKEN, this.db, logger); break
      //default: throw new Error(`Unknown API: ${API}`)
    }
    switch (CONSTS.API.ar) {
      case 'arnode': apiAR = new AWNode("", this.db, logger); break
      //default: throw new Error(`Unknown API: ${API}`)
    }

    this.bsv = new Indexer(this.db, "bsv", CONSTS.FETCH_LIMIT, logger)
    this.ar = new Indexer(this.db, "ar", CONSTS.FETCH_LIMIT, logger)
    this.bsv.indexers = this
    this.ar.indexers = this
  }
  static async start() {
    await Nodes.startTxSync(this)
    await this.ar.start()
    await this.bsv.start()
  }
  static async stop() {
    await this.ar.stop();
    await this.bsv.stop();
    this.db.close();
  }
  static resolver(chain) {
    return this.get(chain)?.resolver
  }
  static get(chain) {
    switch (chain) {
      case 'bsv':
        return this.bsv
      case 'ar':
        return this.ar
      default:
        break;
    }
    return null
  }
}
async function main() {
  Indexers.initDB()
  const seedNode = await Nodes.init(Parser)
  Indexers.init()

  server = new Server(Indexers, logger)
  server.start()

  await Indexers.start()


}

// ------------------------------------------------------------------------------------------------
// shutdown
// ------------------------------------------------------------------------------------------------

async function shutdown() {
  server.stop()
  await Indexers.stop()
  process.exit(0)
}

// ------------------------------------------------------------------------------------------------

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

main()
