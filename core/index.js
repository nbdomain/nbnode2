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
const BlockMgr = require('./blockManager')
const PubSub = require('./pubsub')
const Path = require('path')
let CONFIG = null

try {
  CONFIG = require('../data/config').CONFIG
} catch (e) {
  if (!fs.existsSync(Path.join(__dirname, '../data'))) {
    fs.mkdirSync(Path.join(__dirname, '../data'));
  }
  fs.copyFileSync(Path.join(__dirname, "default_config.js"), Path.join(__dirname, "../data/config.js"))
  console.error("Please edit data/config.js as it fits")
  process.exit(0)
}



// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------
const today = new Date();
var dd = String(today.getMonth() + 1 + "-" + today.getDate());
const logFolder = CONFIG?.path?.log || Path.join(__dirname, "../data/log")
if (!fs.existsSync(logFolder)) {
  fs.mkdirSync(logFolder);
}
var logStream = fs.createWriteStream(Path.join(logFolder, "/log_" + dd + ".txt"), { flags: "a" });
class loggerPlus {
  static logFile(...args) {
    const da = new Date()
    let time = da.getHours() + ":" + da.getMinutes();
    let str = `[${time}] `;
    for (let key of args) {
      if (typeof key === "object" && key !== null) {
        str += JSON.stringify(key) + " ";
      } else str += key + " ";
    }
    logStream.write(str + "\n");
  }
  static log(...args) {
    console.log(...args);
  }
  static info(...args) {
    console.log(...args);
  }
  static error(...args) {
    console.error(...args);
  }
}


const logger = loggerPlus

var myArgs = process.argv.slice(2);
if (myArgs) {
  var argv = parseArgs(myArgs, opts = {})
  logger.info("cmd:", argv);
  logger.logFile("----------------------Node Started----------------------------")
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

class Indexers {
  static initDB() {
    const dbPath = CONFIG?.path?.db || Path.join(__dirname, "../data/db")
    this.db = new Database(dbPath, logger, this)
    this.db.open()
  }

  static async init() {
    this.config = CONFIG
    if (!this.config.chainid) this.config.chainid = 'main'
    if (this.config.tld) {
      CONSTS.tld_config = { ...this.config.tld, ...CONSTS.tld_config }
    }
    this.CONSTS = CONSTS
    this.initDB()
    this.logger = logger
    this.indexer = new Indexer(this.db, this, logger)
    this.Nodes = Nodes
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
      console.error("server start failed")
      return false
    }
    if (!await Nodes.start(this)) {
      console.error("Nodes start failed")
      return false
    }
    if (!await this.indexer.start()) {
      console.error("indexer start failed")
      return false
    }
    if (!this.blockMgr.run()) {
      console.error("blockMrg run failed")
      return false
    }
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
