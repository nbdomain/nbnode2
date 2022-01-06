/**
 * database.js
 *
 * Layer between the database and the application
 */
const fs = require('fs')
const Sqlite3Database = require('better-sqlite3')
const Parser = require('./parser')
const { Util } = require('./util')
const {createChannel} =require("better-sse")
//const { DEFAULT_TRUSTLIST } = require('./config')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const HEIGHT_MEMPOOL = 999999999999999
const HEIGHT_UNKNOWN = null
const HEIGHT_TMSTAMP = 720639
let TXRESOLVED_FLAG = 1
// ------------------------------------------------------------------------------------------------
// Database
// ------------------------------------------------------------------------------------------------

class Database {
  constructor(blockchain, txpath, dmpath, logger) {
    this.blockchain = blockchain
    this.path = txpath
    this.dmpath = dmpath
    this.logger = logger
    this.txdb = null
    this.dmdb = null
    this.tickerAll = createChannel()
    this.tickers = {}
    this.onAddTransaction = null
    this.onDeleteTransaction = null
  }

  open() {
    let noTxdb = false;
    if (this.txdb) throw new Error('Database already open')
    if (!fs.existsSync(this.path)) {
      //const result = Util.downloadFile("https://tnode.nbdomain.com/files/txs.db",this.path)
      //console.log(result)
      fs.copyFileSync(__dirname + "/db/template/txs.db.tpl.db", this.path);
      // noTxdb = true;
    }
    if (!fs.existsSync(this.dmpath)) {
      fs.copyFileSync(__dirname + "/db/template/domains.db.tpl.db", this.dmpath);
    }
      const states = fs.statSync(this.dmpath)
      TXRESOLVED_FLAG = states.birthtimeMs
    

    //--------------------------------------------------------//
    //  Domains DB
    //-------------------------------------------------------//
    this.dmdb = new Sqlite3Database(this.dmpath)
    // 100MB cache
    this.dmdb.pragma('cache_size = 6400')
    this.dmdb.pragma('page_size = 16384')

    // WAL mode allows simultaneous readers
    this.dmdb.pragma('journal_mode = WAL')

    // Synchronizes WAL at checkpoints
    this.dmdb.pragma('synchronous = NORMAL')

    const saveDomainSql = `
    INSERT INTO "nidobj" 
                (domain, nid,owner, owner_key, status, last_txid, lastUpdateBlockId, jsonString, tld) 
                VALUES (?,?, ?,?, ?, ?, ?, ?, ?)
                ON CONFLICT( domain ) DO UPDATE
                SET nid=?,owner=? ,owner_key=?,status=?,last_txid=?,lastUpdateBlockId=?,jsonString=?,tld=?
    `
    this.saveDomainObjStmt = this.dmdb.prepare(saveDomainSql);
    const saveKeysSql = `
    INSERT INTO "keys" 
                (key, value,tags) 
                VALUES ( ?, ?, ?)
                ON CONFLICT( key ) DO UPDATE
                SET value=?,tags=?`
    this.saveKeysStmt = this.dmdb.prepare(saveKeysSql);
    this.readKeyStmt = this.dmdb.prepare('SELECT * from keys where key=?')
    this.saveTagStmt = this.dmdb.prepare(`INSERT INTO "tags" (tag, key) VALUES ( ?, ?)`)
    this.deleteTagStmt = this.dmdb.prepare('DELETE FROM tags where "key"= ?')
    this.getLastResolvedIdStmt = this.dmdb.prepare('SELECT value FROM config WHERE key = \'lastResolvedId\'')
    this.getLastResolvedCursorStmt = this.dmdb.prepare('SELECT value FROM config WHERE key = \'lastResolvedCursor\'')
    this.setLastResolvedIdStmt = this.dmdb.prepare('UPDATE config SET value = ? WHERE key = \'lastResolvedId\'')
    this.setLastResolvedCursorStmt = this.dmdb.prepare('UPDATE config SET value = ? WHERE key = \'lastResolvedCursor\'')
    this.getDomainStmt = this.dmdb.prepare('SELECT * from nidObj where domain = ?')
    this.queryDomainsStmt = this.dmdb.prepare('SELECT * FROM nidobj WHERE owner = ? ')

    //-------------------------------NFT-------------------------------------------
    this.getNFTStmt = this.dmdb.prepare('SELECT * from nfts where symbol=?')
    const addNFTsql = `
    INSERT INTO "nfts" 
                (symbol,attributes,data,log) 
                VALUES ( ?,?,?,'')
                ON CONFLICT( symbol ) DO UPDATE
                SET attributes=?,data=?`
    this.addNFTStmt = this.dmdb.prepare(addNFTsql)
    this.deleteNFTStmt = this.dmdb.prepare("DELETE FROM nfts where symbol = ?")
    this.NFTappendLogStmt = this.dmdb.prepare("UPDATE nfts SET log = log || ?  where symbol = ?")
    this.NFTgetLogStmt = this.dmdb.prepare("SELECT log from nfts where symbol = ?")

    //--------------------------------------------------------//
    //  Transaction DB
    //-------------------------------------------------------//
    this.txdb = new Sqlite3Database(this.path)
    // 100MB cache
    this.txdb.pragma('cache_size = 6400')
    this.txdb.pragma('page_size = 16384')

    // WAL mode allows simultaneous readers
    this.txdb.pragma('journal_mode = WAL')

    // Synchronizes WAL at checkpoints
    this.txdb.pragma('synchronous = NORMAL')

    //this.addNewTransactionStmt = this.txdb.prepare('INSERT OR IGNORE INTO tx (txid, height, time,command,publicKey,inputAddress,output,"in",out) VALUES (?, null, ?, null, null, null, null, null,null)')
    //this.setTransactionBytesStmt = this.txdb.prepare('UPDATE tx SET command = ? ,publicKey= ? ,inputAddress = ? ,output = ? ,"in" = ? ,out = ? WHERE txid = ?')

    this.addNewTransactionStmt = this.txdb.prepare('INSERT OR IGNORE INTO tx (txid, height, time, bytes) VALUES (?, null, ?, null)')
    this.setTransactionBytesStmt = this.txdb.prepare('UPDATE tx SET bytes = ?, txTime = ? WHERE txid = ?')
    this.getRawTransactionStmt = this.txdb.prepare('SELECT bytes AS raw FROM tx WHERE txid = ?')
    this.getTransactionsToDownloadStmt = this.txdb.prepare(`SELECT txid FROM tx WHERE bytes IS NULL`)

    this.setTransactionTimeStmt = this.txdb.prepare('UPDATE tx SET time = ? WHERE txid = ?')
    this.setTransactionHeightStmt = this.txdb.prepare(`UPDATE tx SET height = ? WHERE txid = ? AND (height IS NULL OR height = ${HEIGHT_MEMPOOL})`)
    this.hasTransactionStmt = this.txdb.prepare('SELECT txid FROM tx WHERE txid = ?')
    //this.getTransactionCommandStmt = this.txdb.prepare('SELECT command FROM tx WHERE txid = ?')
    this.getTransactionTimeStmt = this.txdb.prepare('SELECT time FROM tx WHERE txid = ?')
    this.getTransactionHeightStmt = this.txdb.prepare('SELECT height FROM tx WHERE txid = ?')
    this.getUnresolvedTransactionV1 = this.txdb.prepare(`SELECT * FROM tx WHERE height <= ${HEIGHT_TMSTAMP} AND resolved !=${TXRESOLVED_FLAG} ORDER BY id ASC LIMIT ?`)
    this.getUnresolvedTransactionV2 = this.txdb.prepare(`SELECT * FROM tx WHERE height > ${HEIGHT_TMSTAMP} AND resolved !=${TXRESOLVED_FLAG} AND txTime IS NOT NULL ORDER BY time,txTime ASC LIMIT ?`)
    //this.getTransactionDownloadedStmt = this.txdb.prepare('SELECT output IS NOT NULL AS downloaded FROM tx WHERE txid = ?')
    this.getTransactionDownloadedStmt = this.txdb.prepare('SELECT bytes IS NOT NULL AS downloaded FROM tx WHERE txid = ?')
    this.deleteTransactionStmt = this.txdb.prepare('DELETE FROM tx WHERE txid = ?')
    this.unconfirmTransactionStmt = this.txdb.prepare(`UPDATE tx SET height = ${HEIGHT_MEMPOOL} WHERE txid = ?`)
    this.getTransactionsAboveHeightStmt = this.txdb.prepare('SELECT txid FROM tx WHERE height > ?')
    this.getMempoolTransactionsBeforeTimeStmt = this.txdb.prepare(`SELECT txid FROM tx WHERE height = ${HEIGHT_MEMPOOL} AND txTime < ?`)
    //this.getTransactionsToDownloadStmt = this.txdb.prepare(`SELECT txid FROM tx WHERE output IS NULL`)
    this.getTransactionsToDownloadStmt = this.txdb.prepare(`SELECT txid FROM tx WHERE bytes IS NULL`)
    //this.getTransactionsDownloadedCountStmt = this.txdb.prepare('SELECT COUNT(*) AS count FROM tx WHERE output IS NOT NULL')
    this.getTransactionsDownloadedCountStmt = this.txdb.prepare('SELECT COUNT(*) AS count FROM tx WHERE bytes IS NOT NULL')
    this.getHeightStmt = this.txdb.prepare('SELECT height FROM config WHERE role = \'tip\'')
    this.getHashStmt = this.txdb.prepare('SELECT hash FROM config WHERE role = \'tip\'')
    this.setHeightAndHashStmt = this.txdb.prepare('UPDATE config SET height = ?, hash = ? WHERE role = \'tip\'')
    this.getPayTxStmt = this.txdb.prepare('SELECT * from paytx where domain = ? AND type = ?')
    this.setPayTxStmt = this.txdb.prepare('INSERT INTO paytx (domain,payment_txid, tld, protocol, publicKey, raw_tx, ts, type) VALUES (?,?,?,?,?,?,?,?)')

    if (noTxdb) {
      this.saveLastResolvedId(0)
    }
  }

  close() {
    if (this.txdb) {
      this.txdb.close()
      this.txdb = null
      this.dmdb.close()
      this.dmdb = null
    }
  }

  transaction(f) {
    if (!this.txdb) return
    this.txdb.transaction(f)()
  }

  // --------------------------------------------------------------------------
  // tx
  // --------------------------------------------------------------------------

  addNewTransaction(txid) {
    if (this.hasTransaction(txid)) return

    //    const time = Math.round(Date.now() / 1000)

    this.addNewTransactionStmt.run(txid, 9999999999)

    if (this.onAddTransaction) this.onAddTransaction(txid)
  }
  setTransaction(txid, obj) {
    this.setTransactionBytesStmt.run(obj.command, obj.publicKey, obj.inputAddress, JSON.stringify(obj.output), JSON.stringify(obj.out), JSON.stringify(obj.in), txid);
  }
  saveTransaction(txid, rawtx, txTime) {
    const bytes = (this.blockchain == 'bsv' ? Buffer.from(rawtx, 'hex') : Buffer.from(JSON.stringify(rawtx)))
    this.setTransactionBytesStmt.run(bytes, txTime, txid)
  }
  setTransactionResolved(txid){
    this.txdb.prepare(`UPDATE tx set resolved = ${TXRESOLVED_FLAG} where txid=?`).run(txid)
  }
  setTransactionHeight(txid, height) {
    this.setTransactionHeightStmt.run(height, txid)
  }

  setTransactionTime(txid, time) {
    this.setTransactionTimeStmt.run(time, txid)
  }

  getRawTransaction(txid) {
    const row = this.getRawTransactionStmt.raw(true).get(txid)
    return row && row[0]
  }

  getTransactionTime(txid) {
    const row = this.getTransactionTimeStmt.raw(true).get(txid)
    return row && row[0]
  }

  getTransactionHeight(txid) {
    const row = this.getTransactionHeightStmt.raw(true).get(txid)
    return row && row[0]
  }

  deleteTransaction(txid) {
    //  if (deleted.has(txid)) return
    //  deleted.add(txid)

    this.transaction(() => {
      this.deleteTransactionStmt.run(txid)
      if (this.onDeleteTransaction) this.onDeleteTransaction(txid)
    })
  }

  unconfirmTransaction(txid) {
    this.unconfirmTransactionStmt.run(txid)
  }


  hasTransaction(txid) {
    return !!this.hasTransactionStmt.get(txid)
  }
  isTransactionDownloaded(txid) {
    return !!this.getTransactionDownloadedStmt.raw(true).get(txid)[0]
  }
  getTransactionsAboveHeight(height) { return this.getTransactionsAboveHeightStmt.raw(true).all(height).map(row => row[0]) }
  getMempoolTransactionsBeforeTime(time) { return this.getMempoolTransactionsBeforeTimeStmt.raw(true).all(time).map(row => row[0]) }
  getTransactionsToDownload() { return this.getTransactionsToDownloadStmt.raw(true).all().map(row => row[0]) }
  getDownloadedCount() { return this.getTransactionsDownloadedCountStmt.get().count }
  getIndexedCount() { return this.getTransactionsIndexedCountStmt.get().count }
  getNumQueuedForExecution() { return this.numQueuedForExecution }


  // --------------------------------------------------------------------------
  // crawl
  // --------------------------------------------------------------------------

  getHeight() {
    const row = this.getHeightStmt.raw(true).all()[0]
    return row && row[0]
  }

  getHash() {
    const row = this.getHashStmt.raw(true).all()[0]
    return row && row[0]
  }

  setHeightAndHash(height, hash) {
    this.setHeightAndHashStmt.run(height, hash)
  }

  // --------------------------------------------------------------------------
  // resolver
  // --------------------------------------------------------------------------
  getAllPaytx(type) {
    return this.txdb.prepare('SELECT * from paytx where type = ?').all(type);
  }
  deletePaytx(domain, type) {
    this.txdb.prepare('DELETE from paytx where domain = ? AND type = ?').run(domain, type);
  }
  getPaytx(domain, type) {
    return this.getPayTxStmt.get(domain, type);
  }
  setPaytx(obj) {
    this.setPayTxStmt.run(obj.domain, obj.payment_txid, obj.tld, obj.protocol, obj.publicKey, obj.raw_tx, obj.ts, obj.type);
  }
  getUnresolvedTX(count) {
    let list = [];
  if(this.blockchain=='bsv'){
      list = this.getUnresolvedTransactionV1.raw(false).all(count);
    }
    if(list.length==0){ //no more old format tx
      const list1 = this.getUnresolvedTransactionV2.raw(false).all(count);
      list = list.concat(list1)
    }
    
    if (list) {
      for (let i = 0; i < list.length; i++) {
        if (list[i].bytes == null) {
          list.splice(i)
          break;
        }
        const rawtx = (this.blockchain == 'bsv' ? Buffer.from(list[i].bytes).toString('hex') : Buffer.from(list[i].bytes).toString())
        const res = Parser.getParser(this.blockchain).parseRaw({rawtx:rawtx, height:list[i].height,time:list[i].time})
        if (res.code == 0) list[i] = { ...res.obj, ...list[i] }
        else {
          list[i].output = { err: res.msg }
        }
        delete list[i].bytes
      }
    }
    return list;
  }
  loadDomain(domain) {
    const res = this.getDomainStmt.get(domain);
    if (res) {
      return JSON.parse(res.jsonString);
    }
    return null;
  }
  queryTags(expression) {
    let sql = "select DISTINCT tag from tags where tag like ?";
    return this.dmdb.prepare(sql).all(expression);
  }
  saveTags(nidObj) {
    for (var item in nidObj.tag_map) {
      const keyName = item + nidObj.domain;
      this.deleteTagStmt.run(keyName);
      const tags = nidObj.tag_map[item].split(";");
      tags.map(tag => {
        this.saveTagStmt.run(tag, keyName);
      })
    }
  }
  queryKeys({ v, num, startID, tags }) {
    let sql = "select id,key,value,tags from keys ";
    if (v != "1") {
      return { code: 1, message: "invalid v" };
    }
    if (tags != null) {
      let hasOr = (tags.indexOf(';') != -1);
      const hasAnd = (tags.indexOf('+') != -1);
      if (hasOr && hasAnd) {
        return { code: 1, message: "Using both ; and + is not supported yet" };
      }
      if (!hasAnd && !hasOr) hasOr = true;
      if (hasOr) {
        const orTag = tags.split(';').join("','");
        sql += "where key in (select key from tags where tag in ('" + orTag + "')) ";
      }
      if (hasAnd) {
        const addTag = tags.split('+').join("','");
        const count = tags.split('+').length;
        sql += "where key in (select key from tags where tag in ('" + addTag + "') group by key having count(*)>=" + count + ") "
      }
    }
    if (startID != 0) {
      sql += "and id>" + startID + " ";
    }
    if (num) {
      sql += "limit " + num;
    }
    sql += ";";
    return {
      code: 0,
      data: this.dmdb.prepare(sql).all()
    }
  }
  readKey(keyName) {
    try {
      const keyLenName = keyName + "/len";
      const ret = this.readKeyStmt.get(keyName);
      if (ret) {
        const lenRet = this.readKeyStmt.get(keyLenName);
        let value = JSON.parse(ret.value);
        if (lenRet) {
          value.hisLen = +lenRet.value;
        }
        //if(ret.tags)value.tags = ret.tags;
        return value;
      }
    } catch (e) {
      this.logger.error(e)
    }
    return null;
  }
  readKeyHistoryLen(fullName) {
    let lenRet = this.readKeyStmt.get(fullName + "/len");
    return lenRet ? +lenRet.value : null
  }
  readKeyHistory(fullName, pos) {
    const hisKey = fullName + "/" + pos;
    const ret = this.readKeyStmt.get(hisKey);
    if (ret) {
      let value = JSON.parse(ret.value);
      value.hisPos = pos;
      return value;
    }
    return null;
  }
  saveKeyHistory(nidObj, keyName, value, txid) {
    try {
      this.transaction(() => {
        if(nidObj.domain=="10200.test"){
          console.log("found")
        }
        const lenKey = keyName + "." + nidObj.domain + "/len";
        let lenRet = this.readKeyStmt.get(lenKey);
        let count = 0;
        if (lenRet) count = +lenRet.value;
        count++;
        const tags = nidObj.keys[keyName].tags;
        this.saveKeysStmt.run(lenKey, count.toString(),null, count.toString(), null); //save len
        const hisKey = keyName + "." + nidObj.domain + "/" + count;
        this.saveKeysStmt.run(hisKey, JSON.stringify(value), tags, JSON.stringify(value), tags); //save len
        const tag1 = tags.split(';')
        tag1.map(tag => {
          this.saveTagStmt.run(tag, hisKey);
        })
      })
    } catch (e) {
      this.logger.error(e)
    }
  }
  saveKeys(nidObj) {
    for (var item in nidObj.keys) {
      const value = JSON.stringify(nidObj.keys[item]);
      const keyName = item + "." + nidObj.domain;
      const tags = nidObj.keys[item].tags;
      if(tags){
        console.log("tags")
      }
      this.saveKeysStmt.run(keyName, value, tags, value, tags)
      if(this.tickers[keyName]) //notify subscribers
        this.tickers[keyName].broadcast('key_update',value)
      if (value.length > 512) {
        nidObj.keys[item] = '$truncated';
      }
    }
    for (var item in nidObj.users) {
      const value = JSON.stringify(nidObj.users[item]);
      const keyName = item + "@" + nidObj.domain;
      const tags = nidObj.tag_map[item + '@'];
      this.saveKeysStmt.run(keyName, value, tags, value, tags)
      if (value.length > 512) {
        nidObj.keys[item] = '$truncated';
      }
    }
  }
  subscribe(domain,session){
    if(domain=="all"){
      this.tickerAll.register(session)
    }else{
      if(!this.tickers[domain])this.tickers[domain] = createChannel() 
      this.tickers[domain].register(session)
    }
    
  }
  queryDomains(field, value) {
    if (field != null) {
      return this.queryDomainsStmt.all(value);
    }
    return null;
  }
  nftCreate(nft) {
    this.addNFTStmt.run(nft.symbol, JSON.stringify(nft.attributes), JSON.stringify(nft.data), JSON.stringify(nft.attributes), JSON.stringify(nft.data))
    this.deleteNFTStmt.run(nft.symbol + '.testing')
  }
  saveNFT(obj) {
    if (obj.nft_log) {
      for (const symbol in obj.nft_log) {
        const log = obj.nft_log[symbol]
        this.NFTappendLogStmt.run(log, symbol)
      }
      obj.nft_log = {}
    }

  }
  saveDomainObj(obj) {
    try {
      this.transaction(() => {
        if(obj.domain=="10200.test"){
          console.log("found")
        }
        this.saveKeys(obj);
        this.saveTags(obj);
        this.saveNFT(obj);
        this.saveDomainObjStmt.run(obj.domain, obj.nid, obj.owner, obj.owner_key, obj.status, obj.last_txid, obj.lastUpdateBlockId, JSON.stringify(obj), obj.tld,
          obj.nid, obj.owner, obj.owner_key, obj.status, obj.last_txid, obj.lastUpdateBlockId, JSON.stringify(obj), obj.tld)
      })
      this.tickerAll.broadcast("key_update",obj)
    } catch (e) {
      this.logger.error(e)
    }
  }
  queryTX(fromHeight, toHeight) {
    let sql = 'SELECT * from tx where height >= ? AND height <= ?'
    if (fromHeight == -1) {
      toHeight = null
      sql = 'SELECT * from tx where height == ? AND ? IS NULL'
    }
    const ret = this.txdb.prepare(sql).all(fromHeight, toHeight)
    ret.forEach(item => {
      const rawtx = Buffer.from(item.bytes).toString('hex')
      item.rawtx = rawtx
      delete item.bytes
    })
    return ret
  }
  //------------------------------NFT-----------------------------------
  getNFT(symbol) {
    const res = this.getNFTStmt.get(symbol)
    if (res) {
      res.attributes = JSON.parse(res.attributes)
      res.data = JSON.parse(res.data)
    }
    return res
  }
}

// ------------------------------------------------------------------------------------------------

Database.HEIGHT_MEMPOOL = HEIGHT_MEMPOOL
Database.HEIGHT_UNKNOWN = HEIGHT_UNKNOWN

module.exports = Database
