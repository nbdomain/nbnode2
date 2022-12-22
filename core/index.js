/**
 * index.js
 *
 * Entry point
 */

const { CONFIG } = require('../data/config')
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
const PubSub = require('./pubsub')
const Path = require('path')


// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------
const today = new Date();
var dd = String(today.getMonth() + 1 + "-" + today.getDate());
const logFolder = CONFIG.getPath('log')
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
    fs.unlinkSync(Path.join(__dirname , "/db/" + CONSTS.DMDB))
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
    this.db = new Database(CONFIG.getPath("db"), logger, this)
    this.db.open()
  }
  static async checkEnv() {
    const timeSync = NtpTimeSync.getInstance();
    const result = await timeSync.getTime();
    console.log("real time", result.now);
    console.log("offset in milliseconds", result.offset);
    if (Math.abs(result.offset) > 2000) {
      console.error("OS time is not in sync with NTP, please resync")
      return false
    }
    return true
  }
  static async init() {

    if (!await this.checkEnv()) return false
    this.config = CONFIG
    this.initDB()
    this.logger = logger
    this.indexer = new Indexer(this.db, this, logger)
    this.Nodes = Nodes
    this.Parser = Parser
    Util.indexers = this
    this.Util = Util
    this.resolver = this.indexer.resolver
    this.blockMgr = new BlockMgr(this)
    this.pubsub = new PubSub(this)
    this.server = new LocalServer(this, logger)
    return true
  }
  static async start() {
    await this.server.start()
    const seedNode = await Nodes.start(this)
    await this.indexer.start()
    this.blockMgr.run()
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
  await Indexers.start()
}

// ------------------------------------------------------------------------------------------------

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

main()
