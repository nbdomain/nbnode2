/**
 * index.js
 *
 * Entry point
 */
const dotenv = require("dotenv");
const axios = require('axios')


const Indexer = require('./indexer')
const LocalServer = require('./server')
const Database = require('./database')
const { Nodes } = require('./nodes')
const CONSTS = require('./const')
const Parser = require('./parser')
const { Util } = require('./util')
const parseArgs = require('minimist')
const fs = require('fs')
const BlockMgr = require('./blockManager')
const PubSub = require('./pubsub')
const Path = require('path')
const Logger = require('./logger.js')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const logger = new Logger //loggerPlus

var myArgs = process.argv.slice(2);
if (myArgs) {
  var argv = parseArgs(myArgs, opts = {})
  logger.console("cmd:", argv);
  if (argv.reorg) {
    REORG = argv.reorg
    fs.unlinkSync(Path.join(__dirname, "/db/" + CONSTS.DMDB))
  }
}


// ------------------------------------------------------------------------------------------------
// shutdown
// ------------------------------------------------------------------------------------------------

async function shutdown() {
  server && server.stop()
  await Indexers.stop()
  process.exit(0)
}

// ------------------------------------------------------------------------------------------------
// main
// ------------------------------------------------------------------------------------------------
let server = null;
let CONFIG = null
class Indexers {
  static initDB() {
    const { config } = this
    const dbPath = config?.path?.db || Path.join(__dirname, "../data/db")
    this.db = new Database(dbPath, logger, this)
    this.db.open()
  }

  static async init() {
    this.cfgFolder = Path.join(__dirname, "../cfg/")
    dotenv.config({ path: this.cfgFolder + 'env' })
    this.cfg_chain = Util.readJsonFile(Path.join(this.cfgFolder, "chains/" + process.env.chainid + ".json"))
    this.config = this.cfg_chain
    const { config } = this
    this.dataFolder = config.dataDir || Path.join(__dirname, "../data/")
    if (!config.chainid) config.chainid = 'main'

    process.env.publicUrl && (config.server.publicUrl = process.env.publicUrl)
    process.env.adminKey && (config.adminKey = process.env.adminKey)

    this.CONSTS = CONSTS
    this.initDB()
    this.logger = logger
    logger.init(this)
    this.indexer = new Indexer(this.db, this, logger)
    this.Nodes = Nodes
    this.axios = axios
    this.Parser = Parser
    Util.init(this)
    this.Util = Util
    this.resolver = this.indexer.resolver
    this.blockMgr = new BlockMgr(this)
    this.pubsub = new PubSub(this)
    this.server = new LocalServer(this, logger)
    return true
  }
  static async start() {
    if (!await this.server.start()) {
      this.logger.error("server start failed")
      return false
    }
    if (!await Nodes.start(this)) {
      this.logger.error("Nodes start failed")
      return false
    }
    if (!await this.indexer.start()) {
      this.logger.error("indexer start failed")
      return false
    }
    if (!this.blockMgr.run()) {
      this.logger.error("blockMrg run failed")
      return false
    }
    return true
  }
  static async stop() {
    this.indexer && await this.indexer.stop();
    this.db && this.db.close();
  }
  static async shutdown() {
    await shutdown()
  }
}
async function main() {
  if (!await Indexers.init()) {
    process.exit(-1)
  }
  if (!await Indexers.start()) {
    process.exit(-1)
  }
}

// ------------------------------------------------------------------------------------------------

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

main()

module.exports = Indexers