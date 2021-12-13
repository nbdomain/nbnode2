/**
 * index.js
 *
 * Entry point
 */

const Indexer = require('./indexer')
const Server = require('./server')
const Nodes = require('./nodes')
const {
  API, TXDB,DMDB, NETWORK, FETCH_LIMIT, WORKERS, MATTERCLOUD_KEY, PLANARIA_TOKEN, START_HEIGHT,
  MEMPOOL_EXPIRATION, ZMQ_URL, RPC_URL
} = require('./config')
const Planaria = require('./planaria')
const UrChain = require('./urchain')
const RunConnectFetcher = require('./run-connect')
const BitcoinNodeConnection = require('./bitcoin-node-connection')
const parseArgs = require('minimist')
const NbNode = require('./nbnode')
const fs = require('fs')
const AWNode = require('./arweave')
//const BitcoinRpc = require('./bitcoin-rpc')
//const BitcoinZmq = require('./bitcoin-zmq')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const logger = console
logger.info("PLANARIA_TOKEN:",PLANARIA_TOKEN);
var myArgs = process.argv.slice(2);
let REORG = 0;
if(myArgs){
  var argv = parseArgs(myArgs, opts={})
  logger.info("cmd:",argv);
  if(argv.reorg){
    REORG = argv.reorg
    fs.unlinkSync(__dirname+"/db/"+DMDB)
  }
}
let api = null
switch (API) {
  //case 'arnode': api = new AWNode("",logger);break
  //default: throw new Error(`Unknown API: ${API}`)
}
//bsv:new Indexer(__dirname+"/db/"+TXDB,__dirname+"/db/"+DMDB, api, "bsv", FETCH_LIMIT, WORKERS, logger,START_HEIGHT, MEMPOOL_EXPIRATION,REORG),
const apiAR = new AWNode("",logger);
const apiBSV = new Planaria(PLANARIA_TOKEN, logger);
//const indexers = {ar:new Indexer(__dirname+"/db/"+"artx.db",__dirname+"/db/"+"ardomains.db", apiAR, "ar", FETCH_LIMIT, WORKERS, logger,START_HEIGHT, MEMPOOL_EXPIRATION,REORG)}
const indexers = {bsv:new Indexer(__dirname+"/db/"+TXDB,__dirname+"/db/"+DMDB, apiBSV, "bsv", FETCH_LIMIT, WORKERS, logger,START_HEIGHT, MEMPOOL_EXPIRATION,REORG)}

server = new Server(indexers, logger)

// ------------------------------------------------------------------------------------------------
// main
// ------------------------------------------------------------------------------------------------

async function main () {
  await Nodes.init()
  indexers.ar && await indexers.ar.start()
  indexers.bsv && await indexers.bsv.start()
  server.start()
}

// ------------------------------------------------------------------------------------------------
// shutdown
// ------------------------------------------------------------------------------------------------

async function shutdown () {
  server.stop()
  await indexer.stop()
  process.exit(0)
}

// ------------------------------------------------------------------------------------------------

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

main()
