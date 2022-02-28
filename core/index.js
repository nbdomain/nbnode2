/**
 * index.js
 *
 * Entry point
 */

const Indexer = require('./indexer')
const Server = require('./server')
const Nodes = require('./nodes')
const {
  API, TXDB, DMDB, FETCH_LIMIT, WORKERS, PLANARIA_TOKEN, START_HEIGHT,
  MEMPOOL_EXPIRATION,
} = require('./config')
const Planaria = require('./planaria')
//const UrChain = require('./urchain')
//const RunConnectFetcher = require('./run-connect')
//const BitcoinNodeConnection = require('./bitcoin-node-connection')
const parseArgs = require('minimist')
const fs = require('fs')
const AWNode = require('./arweave')
//const BitcoinRpc = require('./bitcoin-rpc')
//const BitcoinZmq = require('./bitcoin-zmq')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const logger = console
logger.info("PLANARIA_TOKEN:", PLANARIA_TOKEN);
var myArgs = process.argv.slice(2);
let REORG = 0;
if (myArgs) {
  var argv = parseArgs(myArgs, opts = {})
  logger.info("cmd:", argv);
  if (argv.reorg) {
    REORG = argv.reorg
    fs.unlinkSync(__dirname + "/db/" + DMDB)
  }
}


// ------------------------------------------------------------------------------------------------
// main
// ------------------------------------------------------------------------------------------------
let indexers = null, server = null;
let apiAR = null, apiBSV = null;
class Indexers{
  static init(){
    this.bsv = new Indexer(__dirname + "/db/" + TXDB, __dirname + "/db/" + DMDB, apiBSV, "bsv", FETCH_LIMIT, WORKERS, logger, START_HEIGHT, MEMPOOL_EXPIRATION, REORG)
    this.ar = new Indexer(__dirname + "/db/" + TXDB, __dirname + "/db/" + DMDB, apiAR, "ar", FETCH_LIMIT, WORKERS, logger, START_HEIGHT, MEMPOOL_EXPIRATION, REORG)
  }
  static async start(){
    await this.ar.start()
    await this.bsv.start()
  }
  static async stop(){
    await this.ar.stop();
    await this.bsv.stop();
  }
  static resolver(chain){
    return this.get(chain).resolver
  }
  static get(chain){
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

  switch (API.bsv) {
    case 'planaria': apiBSV = new Planaria(PLANARIA_TOKEN, logger); break
    //default: throw new Error(`Unknown API: ${API}`)
  }
  switch (API.ar) {
    case 'arnode': apiAR = new AWNode("", logger); break
    //default: throw new Error(`Unknown API: ${API}`)
  }
  //bsv:new Indexer(__dirname+"/db/"+TXDB,__dirname+"/db/"+DMDB, api, "bsv", FETCH_LIMIT, WORKERS, logger,START_HEIGHT, MEMPOOL_EXPIRATION,REORG),

  //const indexers = {ar:new Indexer(__dirname+"/db/"+"artx.db",__dirname+"/db/"+"ardomains.db", apiAR, "ar", FETCH_LIMIT, WORKERS, logger,START_HEIGHT, MEMPOOL_EXPIRATION,REORG)}
  const seedNode = await Nodes.init()
  Indexers.init()

  server = new Server(Indexers, logger)

  await Indexers.start()
  server.start()
  
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
