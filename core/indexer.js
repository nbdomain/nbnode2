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
const fs = require('fs')
const Parser = require('./parser')
const Nodes = require('./nodes')
const axios = require('axios')
const { CONFIG } = require('./config')
const process = require('process')

// ------------------------------------------------------------------------------------------------
// Indexer
// ------------------------------------------------------------------------------------------------

class Indexer {
  constructor(db, api, chain, numParallelDownloads, numParallelExecutes, logger, startHeight, mempoolExpiration, reOrg) {
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

    this.api = api
    this.chain = chain
    this.startHeight = startHeight
    this.mempoolExpiration = mempoolExpiration
    this.reorg = reOrg

    const fetchFunction = this.api.fetch ? this.api.fetch.bind(this.api) : null

    this.database = db; //new Database(chain, txdb, dmdb, this.logger)
    this.downloader = new Downloader(fetchFunction, numParallelDownloads)

    this.crawler = new Crawler(api)
    this.resolver = new Resolver(this.chain, this.database)
    Parser.get(this.chain).init(this.database)

    //this.database.onAddTransaction = this._onAddTransaction.bind(this)
    //this.database.onDeleteTransaction = this._onDeleteTransaction.bind(this)
    //this.database.onUnindexTransaction = this._onUnindexTransaction.bind(this)

    this.downloader.onDownloadTransaction = this._onDownloadTransaction.bind(this)
    this.downloader.onFailedToDownloadTransaction = this._onFailedToDownloadTransaction.bind(this)
    this.downloader.onRetryingDownload = this._onRetryingDownload.bind(this)

    this.crawler.onCrawlError = this._onCrawlError.bind(this)
    this.crawler.onCrawlBlockTransactions = this._onCrawlBlockTransactions.bind(this)
    this.crawler.onRewindBlocks = this._onRewindBlocks.bind(this)
    this.crawler.onMempoolTransaction = this._onMempoolTransaction.bind(this)
    this.crawler.onExpireMempoolTransactions = this._onExpireMempoolTransactions.bind(this)
  }
  async restart() {
    await this.stop();
    //fs.copyFileSync(this.database.path, __dirname + "/public/txs.db");
    //fs.copyFileSync(this.database.dmpath,__dirname+"/public/domains.db");
    process.kill(process.pid, 'SIGINT')
  }
  async syncFromNode() {
    const apiURL = Nodes.get()
    const latestTime = this.database.getLatestTxTime(this.chain)
    const url = apiURL + "/api/queryTX?from=" + latestTime + "&chain=" + this.chain
    try {
      const res = await axios.get(url)
      //console.log(res)
      for (const tx of res.data) {
        this.add(tx.txid, tx.rawtx, tx.height, tx.time)
        if (tx.oDataRecord) {
          const item = tx.oDataRecord
          this.database.saveData({ data: item.raw, owner: item.owner, time: item.time })
        }
        console.log("syncFromNode: Adding ", tx.txid)
      }
    } catch (e) {
      console.error("syncFromNode " + apiURL + ": " + e.message)
    }
  }
  async start() {

    let height = this.database.getHeight(this.chain) || this.startHeight
    console.log("startHeight:", this.startHeight, " height:", height)
    let hash = this.database.getHash(this.chain)
    if (this.reorg) {
      height -= this.reorg
      hash = null
    }
    await this.syncFromNode()

    if (this.api.connect) await this.api.connect(height, this.chain)
    this.database.getTransactionsToDownload(this.chain).forEach(txid => this.downloader.add(txid))
    this.crawler.start(height, hash)
    this.resolver.start()
    if (CONFIG.exit_count != 0)
      this.restartTimer = setTimeout(this.restart.bind(this), 60 * 1000 * CONFIG.exit_count);
  }

  async stop() {
    this.logger.info('stopping...')
    this.resolver.stop()
    this.crawler.stop()
    if (this.api.disconnect) await this.api.disconnect()
    this.downloader.stop()
    this.database.close()
  }

  add(txid, hex = null, height = null, time = null) {
    txid = this._parseTxid(txid)
    this._addTransactions([txid], [hex], height, time)
  }

  remove(txid) {
    txid = this._parseTxid(txid)
    this.downloader.remove(txid)
    this.database.deleteTransaction(txid, this.chain)
  }



  rawtx(txid) {
    txid = this._parseTxid(txid)
    const ret = this.database.getRawTransaction(txid, this.chain)
    return ret
  }

  time(txid) {
    txid = this._parseTxid(txid)
    return this.database.getTransactionTime(txid, this.chain)
  }
  status() {
    return {
      height: this.crawler.height,
      hash: this.crawler.hash,
      downloading: this.downloader.remaining()
    }
  }

  async _onDownloadTransaction(txid, hex, height, time) {
    this.logger.info(`Downloaded ${txid} (${this.downloader.remaining()} remaining)`)
    if (!this.database.hasTransaction(txid, this.chain)) return
    if (height) this.database.setTransactionHeight(txid, height, this.chain)
    if (time) this.database.setTransactionTime(txid, time)
    await this._parseAndStoreTransaction(txid, hex)
    if (this.onDownload) this.onDownload(txid)
  }

  _onFailedToDownloadTransaction(txid, e) {
    this.logger.error('Failed to download', txid, e.toString())
    if (this.onFailToDownload) this.onFailToDownload(txid)
  }

  _onRetryingDownload(txid, secondsToRetry) {
    this.logger.info('Retrying download', txid, 'after', secondsToRetry, 'seconds')
  }

  _onAddTransaction(txid) {
    this.logger.info('Added', txid)
  }

  _onDeleteTransaction(txid) {
    this.logger.info('Removed', txid)
  }

  _onUnindexTransaction(txid) {
    this.logger.info('Unindexed', txid)
  }


  _onCrawlError(e) {
    console.error(e)
    this.logger.error(`Crawl error: ${e.toString()}`)
  }

  _onCrawlBlockTransactions(height, hash, time, txids, txhexs) {
    this.logger.info(`${this.chain}: Crawled block ${height} for ${txids.length} transactions`)
    this._addTransactions(txids, txhexs, height, time)
    this.database.setHeightAndHash(height, hash, this.chain)
    if (this.onBlock) this.onBlock(height)
  }

  _onRewindBlocks(newHeight) {
    this.logger.info(`Rewinding to block ${newHeight}`)

    const txids = this.database.getTransactionsAboveHeight(newHeight, this.chain)

    this.database.transaction(() => {
      // Put all transactions back into the mempool. This is better than deleting them, because
      // when we assume they will just go into a different block, we don't need to re-execute.
      // If they don't make it into a block, then they will be expired in time.
      txids.forEach(txid => this.database.unconfirmTransaction(txid, this.chain))

      this.database.setHeightAndHash(newHeight, null, this.chain)
    })

    if (this.onReorg) this.onReorg(newHeight)
  }

  _onMempoolTransaction(txid, hex) {
    this._addTransactions([txid], [hex], Database.HEIGHT_MEMPOOL, null)
  }

  _onExpireMempoolTransactions() {
    const expirationTime = Math.round(Date.now() / 1000) - this.mempoolExpiration

    const expired = this.database.getMempoolTransactionsBeforeTime(expirationTime, this.chain)
    const deleted = new Set()
    this.database.transaction(() => expired.forEach(txid => this.database.deleteTransaction(txid, this.chain)))
  }

  _addTransactions(txids, txhexs, height, time) {
    this.database.transaction(() => {
      txids.forEach((txid, i) => {
        this.database.addNewTransaction(txid, this.chain)
        if (height) this.database.setTransactionHeight(txid, height, this.chain)
        if (time) this.database.setTransactionTime(txid, time, this.chain)
      })

      txids.forEach(async (txid, i) => {
        let downloaded = this.database.isTransactionDownloaded(txid, this.chain)
        if (downloaded) return

        const hex = txhexs && txhexs[i]
        if (hex) {
          await this._parseAndStoreTransaction(txid, hex)
        } else {
          this.downloader.add(txid)
        }
      })
    })
  }

  async _parseAndStoreTransaction(txid, rawtx) {
    if (this.database.isTransactionDownloaded(txid, this.chain)) return

    if (!rawtx) {
      this.logger.warn(txid, ":", "no rawtx");
      return
    }
    const height = this.database.getTransactionHeight(txid, this.chain);
    const block_time = this.database.getTransactionTime(txid, this.chain);
    let meta = null
    try {
      meta = await Parser.get(this.chain).verify(rawtx, height, block_time);
      if (meta.code != 0) {
        this.logger.warn(txid, ":" + meta.msg);
        this.database.deleteTransaction(txid, this.chain);
        return;
      }
    } catch (e) {
      console.error(e);
      this.database.deleteTransaction(txid, this.chain);
      return;
    }
    //this.database.setTransaction(txid, meta.obj)
    this.database.saveTransaction(txid, rawtx, meta.txTime, this.chain)
    return



  }

  _parseTxid(txid) {
    //  txid = txid.trim().toLowerCase()
    //  if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error('Not a txid: ' + txid)
    return txid
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Indexer
