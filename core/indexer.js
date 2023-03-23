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
const { DEF } = require('./def')
const process = require('process')
const { Util } = require('./util')

// ------------------------------------------------------------------------------------------------
// Indexer
// ------------------------------------------------------------------------------------------------

class Indexer {
  constructor(db, indexers, logger) {
    this.logger = logger || {}
    this.logger.info = this.logger.info || (() => { })
    this.logger.warn = this.logger.warn || (() => { })
    this.logger.error = this.logger.error || (() => { })
    this.logger.debug = this.logger.debug || (() => { })
    this.indexers = indexers
    this.onDownload = null
    this.onFailToDownload = null
    this.onIndex = null
    this.onFailToIndex = null
    this.onBlock = null
    this.onReorg = null


    this.database = db;
    this.resolver = new Resolver(this.database, indexers)
    //this.resolver.addController(Nodes)
    Parser.init(this.database)

  }
  async restart() {
    await this.stop();
    process.kill(process.pid, 'SIGINT')
  }
  pauseResolve(pause) {
    this.resolver.pauseResolve = pause
  }

  async start() {
    const { config } = this.indexers
    this.resolver.start()
    //if (config.exit_count != 0)
    //  this.restartTimer = setTimeout(this.restart.bind(this), 60 * 1000 * config.exit_count);
    return true
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

  async addTxFull({ txid, sigs, rawtx, txTime, oDataRecord, force = false, chain, replace = false }) {
    try {
      //console.log("adding:", txid)

      const { Nodes, resolver } = this.indexers
      if (!force && this.database.hasTransaction(txid) && !replace) {
        console.log("Skipping:", txid)
        if (sigs) {
          this.database.addTransactionSigs(txid, sigs)
        }
        return false
      }
      if (!await Util.verifyRaw({ expectedId: txid, rawtx, chain })) {
        console.error("rawtx verify error:", txid)
        return false
      }
      if (!await Nodes.verifySigs({ txTime, txid, sigs })) {
        console.error("tx sigs verification failed. sigs:", sigs)
        return false
      }
      let ret = await (Parser.parseTX({ rawtx: rawtx, oData: oDataRecord?.raw, time: txTime, chain }));

      let ts = 0, status = 0
      if (ret.code != 0 || !ret.rtx) status = DEF.TX_INVALIDTX
      else {
        ts = (ret.rtx.ts ? +ret.rtx.ts : +ret.rtx.time)
        if (ret.rtx.ts) txTime = ret.rtx.ts
      }


      if (txTime < 1652788076 || ret.code == 0) { //save old invalid tx and valid tx
        await this.database.addFullTx({ txid, rawtx, txTime, status, oDataRecord, chain, replace: replace || force })
        if (sigs) {
          this.database.addTransactionSigs(txid, sigs)
        }
        this.indexers.blockMgr.onNewTx(txid)
        console.log("Added txid:", txid)
        const list = this.database.getUnresolvedTX(1)
        if (list && list.length > 0) {
          //resolver.resolveOneTX(list[0])
        }
      }
      else {
        console.error("Invalid tx:", ret, txid)
      }
      return ret.code == 0;
    } catch (e) {
      console.error("Invalid tx:", txid, e.message)
      return false
    }

  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Indexer
