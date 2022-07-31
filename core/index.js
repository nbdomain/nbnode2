/**
 * index.js
 *
 * Entry point
 */

const Indexer = require('./indexer')
const LocalServer = require('./server')
const Database = require('./database')
const { Nodes } = require('./nodes')
const CONSTS = require('./const')
const Parser = require('./parser')
const { Util } = require('./util')
const parseArgs = require('minimist')
const fs = require('fs')
const NtpTimeSync = require("ntp-time-sync").NtpTimeSync
const BlockMgr = require('./blockManager')


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
  static async checkEnv() {
    const timeSync = NtpTimeSync.getInstance();
    const result = await timeSync.getTime();
    console.log("real time", result.now);
    console.log("offset in milliseconds", result.offset);
    if (Math.abs(result.offset) > 1000) {
      console.error("OS time is not in sync with NTP, please resync")
      return false
    }
    return true
  }
  static async init() {

    if (!await this.checkEnv()) return false
    this.initDB()
    this.indexer = new Indexer(this.db, CONSTS.FETCH_LIMIT, logger)
    //this.ar = new Indexer(this.db, "ar", CONSTS.FETCH_LIMIT, logger)
    this.indexer.indexers = this
    this.Nodes = Nodes
    this.Parser = Parser
    this.Util = Util
    this.resolver = this.indexer.resolver
    this.blockMgr = new BlockMgr(this)
    return true
  }
  static async start() {
    //await this.db.verifyTxDB('bsv')
    await Nodes.startTxSync(this)
    await this.indexer.start()

    this.blockMgr.run()
  }
  static async stop() {
    await this.indexer.stop();
    this.db.close();
  }
}
async function main() {
  if (!await Indexers.init()) {
    process.exit(-1)
  }

  server = new LocalServer(Indexers, logger)
  server.start()

  const seedNode = await Nodes.init(Indexers)

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
