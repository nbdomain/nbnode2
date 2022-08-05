/**
 * indexer.js
 *
 * Main object that discovers, downloads, executes and stores RUN transactions
 */

//const bsv = require('bsv')
const Database = require('./database')
const Downloader = require('./downloader')
const Crawler = require('./crawler')
const Resolver = require('./resolver')
const Parser = require('./parser')
const { BSVChain } = require('./chains')
const { Nodes } = require('./nodes')
const { CONFIG } = require('./config')
const { DEF } = require('./def')
const process = require('process')
const { Util } = require('./util')

// ------------------------------------------------------------------------------------------------
// Indexer
// ------------------------------------------------------------------------------------------------

class Indexer {
  constructor(db, numParallelDownloads, logger) {
    this.logger = logger || {}
    this.logger.info = this.logger.info || (() => { })
    this.logger.warn = this.logger.warn || (() => { })
    this.logger.error = this.logger.error || (() => { })
    this.logger.debug = this.logger.debug || (() => { })

    this.onDownload = null
    this.onFailToDownload = null
    this.onIndex = null
    this.onFailToIndex = null
    this.onBlock = null
    this.onReorg = null


    this.database = db; //new Database(chain, txdb, dmdb, this.logger)
    //    this.downloader = new Downloader(BSVChain.fetchRaw, numParallelDownloads)

    //this.crawler = new Crawler(api, db, this.chain)
    this.resolver = new Resolver(this.database)
    //this.resolver.addController(Nodes)
    Parser.init(this.database)

    //    this.downloader.onDownloadTransaction = this._onDownloadTransaction.bind(this)
    //    this.downloader.onFailedToDownloadTransaction = this._onFailedToDownloadTransaction.bind(this)
    //    this.downloader.onRetryingDownload = this._onRetryingDownload.bind(this)

    /*this.crawler.onCrawlError = this._onCrawlError.bind(this)
    this.crawler.onCrawlBlockTransactions = this._onCrawlBlockTransactions.bind(this)
    this.crawler.onRewindBlocks = this._onRewindBlocks.bind(this)
    this.crawler.onMempoolTransaction = this._onMempoolTransaction.bind(this)
    this.crawler.onExpireMempoolTransactions = this._onExpireMempoolTransactions.bind(this)
    this.crawler.onConfirmTransactions = this._onConfirmTransactions.bind(this)*/
  }
  async restart() {
    await this.stop();
    //fs.copyFileSync(this.database.path, __dirname + "/public/txs.db");
    //fs.copyFileSync(this.database.dmpath,__dirname+"/public/domains.db");
    process.kill(process.pid, 'SIGINT')
  }
  pauseResolve(pause) {
    this.resolver.pauseResolve = pause
  }
  /*async reCrawlAll() {
    this.database.setHeightAndHash(this.startHeight, "", this.chain)
    await this.stop();
    this.start()
  }*/
  async start() {
    this.resolver.start()
    if (CONFIG.exit_count != 0)
      this.restartTimer = setTimeout(this.restart.bind(this), 60 * 1000 * CONFIG.exit_count);
  }


  async stop() {
    this.logger.info('stopping...')
    this.resolver.stop()
  }

  add(txid, hex = null, height = null, time = null) {
    txid = this._parseTxid(txid)
    this._addTransactions([txid], [hex], height, time)
  }

  remove(txid) {
    txid = this._parseTxid(txid)
    this.downloader.remove(txid)
    this.database.deleteTransaction(txid)
  }

  rawtx(txid) {
    txid = this._parseTxid(txid)
    const ret = this.database.getRawTransaction(txid)
    return ret
  }

  time(txid) {
    txid = this._parseTxid(txid)
    return this.database.getTransactionTime(txid)
  }

  async addTxFull({ txid, rawtx, txTime, oDataRecord, noVerify = false, force = false, chain, replace = false }) {

    if (!force && this.database.isTransactionParsed(txid, false)) {
      console.log("Skipping:", txid)
      return false
    }
    const tid = Util.rawToTxid(rawtx, chain)
    if (tid !== txid) {
      console.error("txid verify error:", txid)
      return false
    }
    /*if (noVerify && time) {
      this.indexers.blockMgr.onNewTx(txid)
      return await this.database.addFullTx({ txid, rawtx, time, txTime, oDataRecord, chain })
    }*/

    let ret = await (Parser.parseTX({ rawtx: rawtx, oData: oDataRecord?.raw, time: txTime, chain }));

    let ts = 0
    if (ret.code != 0 || !ret.rtx) ts = DEF.TX_INVALIDTX
    else {
      ts = (ret.rtx.ts ? +ret.rtx.ts : +ret.rtx.time)
      if (txTime) ts = +txTime
    }


    if (txTime < 1652788076 || ret.code == 0) { //save old invalid tx and valid tx
      await this.database.addFullTx({ txid, rawtx, txTime: ts, oDataRecord, chain, replace: replace || force })
      this.indexers.blockMgr.onNewTx(txid)
      console.log("Added txid:", txid)
    }
    else {
      console.error("Invalid tx:", ret, txid)
    }
    return ret.code == 0;
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Indexer
