/**
 * database.js
 *
 * Layer between the database and the application
 */
const fs = require('fs')
const Sqlite3Database = require('better-sqlite3')
const Parser = require('./parser')
const { Util } = require('./util')
const { createChannel } = require("better-sse")
const { CONFIG } = require('./config')
const { DEF, MemDomains } = require('./def')

var Path = require('path');
const { default: axios } = require('axios')
const hash = require('bsv/lib/crypto/hash')
let wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

const HEIGHT_MEMPOOL = 999999999999999
const HEIGHT_UNKNOWN = null
const HEIGHT_TMSTAMP = 720639
let TXRESOLVED_FLAG = 1
const VER_DMDB = 10
const VER_TXDB = 5

// ------------------------------------------------------------------------------------------------
// Database
// ------------------------------------------------------------------------------------------------

class Database {
  constructor(txpath, dmpath, logger, indexers) {
    //this.chain = chain
    this.dtpath = __dirname + "/db/odata.db"
    this.path = txpath
    this.dmpath = dmpath
    this.logger = logger
    this.txdb = null
    this.dmdb = null
    this.tickerAll = createChannel()
    this.tickers = {}
    this.onAddTransaction = null
    this.onDeleteTransaction = null
    this.onResetDB = null
    this.resolvedHeight = -1
    this.indexers = indexers
  }
  open() {
    let noTxdb = false;
    if (!this.txdb) {
      if (!fs.existsSync(this.path + "." + VER_TXDB)) {
        if (fs.existsSync(this.path)) {
          fs.unlinkSync(this.path)
          fs.unlinkSync(this.dmpath)
        }
        fs.writeFileSync(this.path + "." + VER_TXDB, "do not delete this file");
      }
      if (!fs.existsSync(this.dmpath + "." + VER_DMDB)) {
        if (fs.existsSync(this.dmpath)) {
          fs.unlinkSync(this.dmpath)
          //fs.unlinkSync(this.dmpath + "-shm")
          //fs.unlinkSync(this.dmpath + "-wal")
        }
        fs.writeFileSync(this.dmpath + "." + VER_DMDB, "do not delete this file");
      }

      if (!fs.existsSync(this.path)) {
        //const result = Util.downloadFile(`https://tnode.nbdomain.com/files/txs.db`, this.path)
        //console.log(result)
        if (!fs.existsSync(this.path))
          fs.copyFileSync(__dirname + "/db/template/txs.db.tpl.db", this.path);
        // noTxdb = true;
      }
      if (!fs.existsSync(this.dmpath)) {
        fs.copyFileSync(__dirname + "/db/template/domains.db.tpl.db", this.dmpath);
      }
      if (!fs.existsSync(this.dtpath)) {
        fs.copyFileSync(__dirname + "/db/template/odata.db.tpl.db", this.dtpath);
      }
      const states = fs.statSync(this.dmpath + "." + VER_DMDB)
      TXRESOLVED_FLAG = states.birthtimeMs
    }
    //--------------------------------------------------------//
    //  Domains DB
    //-------------------------------------------------------//
    if (!this.dmdb) {
      this.dmdb = new Sqlite3Database(this.dmpath)
      // 100MB cache
      this.dmdb.pragma('cache_size = 6400')
      this.dmdb.pragma('page_size = 16384')

      // WAL mode allows simultaneous readers
      this.dmdb.pragma('journal_mode = WAL')

      // Synchronizes WAL at checkpoints
      this.dmdb.pragma('synchronous = NORMAL')
    }


    const saveKeysSql = `
    INSERT INTO "keys" 
                (key, value,tags,ts) 
                VALUES ( ?, ?, ?,?)
                ON CONFLICT( key ) DO UPDATE
                SET value=?,tags=?,ts=?`
    this.saveKeysStmt = this.dmdb.prepare(saveKeysSql);
    this.readKeyStmt = this.dmdb.prepare('SELECT * from keys where key=?')
    this.saveTagStmt = this.dmdb.prepare(`INSERT INTO "tags" (tag, key) VALUES ( ?, ?)`)
    this.deleteTagStmt = this.dmdb.prepare('DELETE FROM tags where "key"= ?')
    //this.getLastResolvedIdStmt = this.dmdb.prepare('SELECT value FROM config WHERE key = \'lastResolvedId\'')
    //this.getLastResolvedCursorStmt = this.dmdb.prepare('SELECT value FROM config WHERE key = \'lastResolvedCursor\'')
    //this.setLastResolvedIdStmt = this.dmdb.prepare('UPDATE config SET value = ? WHERE key = \'lastResolvedId\'')
    //this.setLastResolvedCursorStmt = this.dmdb.prepare('UPDATE config SET value = ? WHERE key = \'lastResolvedCursor\'')
    this.getDomainStmt = this.dmdb.prepare('SELECT * from nidObj where domain = ?')


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
    if (!this.txdb) {


      this.txdb = new Sqlite3Database(this.path)
      // 100MB cache
      this.txdb.pragma('cache_size = 6400')
      this.txdb.pragma('page_size = 16384')

      // WAL mode allows simultaneous readers
      this.txdb.pragma('journal_mode = WAL')

      // Synchronizes WAL at checkpoints
      this.txdb.pragma('synchronous = NORMAL')
    }

    //this.get = this.txdb.prepare(`SELECT hash FROM ${this.chain}_config WHERE role = \'tip\'`)
    //this.setHeightAndHashStmt = this.txdb.prepare(`UPDATE ${this.chain}_config SET height = ?, hash = ? WHERE role = \'tip\'`)

    //this.getPayTxStmt = this.txdb.prepare('SELECT * from paytx where domain = ? AND type = ?')
    //this.setPayTxStmt = this.txdb.prepare('INSERT INTO paytx (domain,payment_txid, tld, protocol, publicKey, raw_tx, ts, type) VALUES (?,?,?,?,?,?,?,?)')

    if (noTxdb) {
      this.saveLastResolvedId(0)
    }

    //----------------------------DATA DB----------------------------------
    this.dtdb = new Sqlite3Database(this.dtpath)
    // 100MB cache
    this.dtdb.pragma('cache_size = 6400')
    this.dtdb.pragma('page_size = 16384')
    // WAL mode allows simultaneous readers
    this.dtdb.pragma('journal_mode = WAL')
    // Synchronizes WAL at checkpoints
    this.dtdb.pragma('synchronous = NORMAL')
    this.preDealData()
    this.backupDB()
  }
  resetDB(type = 'domain') {
    if (type === 'domain') {
      this.writeConfig("dmdb", "domainHash", null)
      this.writeConfig("dmdb", "maxResolvedTx", null)
      this.writeConfig("dmdb", "maxResolvedTxTime", 0 + '')

      let sql = "DELETE from nidobj"
      this.dmdb.prepare(sql).run()
      sql = "DELETE from keys"
      this.dmdb.prepare(sql).run()
      sql = "DELETE from users"
      this.dmdb.prepare(sql).run()
      sql = "DELETE from tags"
      this.dmdb.prepare(sql).run()
      sql = "UPDATE config set value = 0 where key = 'domainUpdates'"
      this.dmdb.prepare(sql).run()
      MemDomains.clearObj()

      fs.unlinkSync(this.dmpath + "." + VER_DMDB)
      fs.writeFileSync(this.dmpath + "." + VER_DMDB, "do not delete this file");
      const states = fs.statSync(this.dmpath + "." + VER_DMDB)
      TXRESOLVED_FLAG = states.birthtimeMs
      this.resolvedHeight = -1
    }
    if (this.onResetDB) {
      this.onResetDB(type)
    }
  }
  preDealData() {
    try {
      //this.combineTXDB();
      let sql = ""
      try {
        sql = "ALTER TABLE txs ADD sigs text"
        this.txdb.prepare(sql).run()
      } catch (e) { }

      try {
        sql = "ALTER TABLE txs RENAME COLUMN time TO status"
        this.txdb.prepare(sql).run()
      } catch (e) { }


      sql = `
      CREATE TABLE IF NOT EXISTS blocks (
        height INTEGER PRIMARY KEY UNIQUE DEFAULT (0),
        body   TEXT,
        hash   TEXT UNIQUE,
        sigs   TEXT
    );    
    `
      this.txdb.prepare(sql).run();

      // sql = "DROP table IF EXISTS nodes"
      // this.txdb.prepare(sql).run()

      sql = `
      CREATE TABLE IF NOT EXISTS nodes (
        url     TEXT    UNIQUE PRIMARY KEY,
        info    TEXT,
        score   INTEGER DEFAULT (100),
        correct INTEGER DEFAULT (1),
        mistake    INTEGER DEFAULT (0),
        pkey    TEXT    UNIQUE
    );    
    `
      this.txdb.prepare(sql).run();
    } catch (e) {
      console.log(e)
    }
  }
  dropTable(name) {
    try {
      let sql = "DROP table IF EXISTS " + name
      this.txdb.prepare(sql).run()
    } catch (e) {
      return false
    }

  }
  /*combineTXDB() {
    try {
      let sql = `
    CREATE TABLE txs(id INTEGER PRIMARY KEY AUTOINCREMENT DEFAULT (1),
                                  txid     TEXT    UNIQUE NOT NULL,
                                  bytes    BLOB,
                                  height   INTEGER,
                                  time     INTEGER,
                                  txTime   INTEGER DEFAULT (0),
                                  chain    TEXT,
                                  resolved BOOLEAN DEFAULT (0)  )
    `
      this.txdb.prepare(sql).run();
      sql = 'select * from ar_tx'
      const artxs = this.txdb.prepare(sql).all()
      for (const item of artxs) {
        if (item.txTime === item.time) item.time = 9999999999
        item.chain = 'ar'
      }
      sql = 'select * from bsv_tx'
      const bsvtxs = this.txdb.prepare(sql).all()
      for (const item of bsvtxs) {
        if (item.txTime === 2) item.txTime = item.id + 100
        if (item.txTime === item.time) item.time = 9999999999
        item.chain = 'bsv'
      }
      const alltxs = bsvtxs.concat(artxs)
      alltxs.sort((a, b) => {
        //if (a.txTime === 2 || b.txTime === 2) return 0
        if (a.txTime === 1 || b.txTime === 1) return 0
        return a.txTime > b.txTime ? 1 : -1
      })
      for (const item of alltxs) {
        sql = 'insert into txs (txid,bytes,height,time,txTime,chain) values (?,?,?,?,?,?)';
        this.txdb.prepare(sql).run(item.txid, item.bytes, item.height, item.time, item.txTime, item.chain)
      }
      console.log("finish")
    } catch (e) {
      console.log(e)
    }
  } */
  close() {
    if (this.txdb) {
      console.log("closing txdb...")
      this.txdb.close()
      this.txdb = null
    }
    if (this.dmdb) {
      console.log("closing dmdb...")
      this.dmdb.close()
      this.dmdb = null
    }
    if (this.dtdb) {
      console.log("closing dtdb...")
      this.dtdb.close()
      this.dtdb = null
    }

  }

  resetBlocks() {
    this.dropTable("blocks")
    let sql = `
      CREATE TABLE IF NOT EXISTS blocks (
        height INTEGER PRIMARY KEY UNIQUE DEFAULT (0),
        body   TEXT,
        hash   TEXT UNIQUE,
        sigs   TEXT
    );    
    `
    this.txdb.prepare(sql).run();
  }
  async backupDB() {
    //const { createGzip } = require('zlib');
    //const { pipeline } = require('stream');

    try {
      const dbname = __dirname + `/db/bkDomains.db`
      // const gzip = createGzip();
      // const source = fs.createReadStream(dbname);
      // const destination = fs.createWriteStream(dbname + '.gz');

      if (fs.existsSync(dbname))
        fs.unlinkSync(dbname)
      const sql = "VACUUM main INTO '" + dbname + "'"
      console.log("backup to:", dbname)
      this.dmdb.prepare(sql).run()

      //    await this.dmdb.backup(dbname)
      /* pipeline(source, gzip, destination, (err) => {
         if (err) {
           console.error('An error occurred:', err);
           process.exitCode = 1;
         }
         console.log("backup finished")
       });*/
    } catch (e) {
      console.error(e.message)
    }

  }

  tx_transaction(f) {
    if (!this.txdb) return
    this.txdb.transaction(f)()
  }
  dm_transaction(f) {
    if (!this.dmdb) return
    this.dmdb.transaction(f)()
  }


  // --------------------------------------------------------------------------
  // tx
  // --------------------------------------------------------------------------

  getLatestTxTime() {
    const sql = `SELECT txTime from txs where status!=1 ORDER BY txTime DESC`
    const res = this.txdb.prepare(sql).get()
    return res ? res.txTime : -1
  }

  getFullTx({ txid }) {
    const tx = this.getTransaction(txid);
    if (!tx) return null
    if (tx && tx.bytes)
      delete tx.bytes
    let ret = {
      tx: tx
    }
    ret.tx.rawtx = this.getRawTransaction(txid)
    if (ret.tx.rawtx) {
      const attrib = Parser.getAttrib({ rawtx: ret.tx.rawtx, chain: tx.chain });
      if (attrib.hash) {
        ret.oDataRecord = this.readData(attrib.hash)
      }
    }
    return ret
  }
  addFullTx({ txid, rawtx, txTime, oDataRecord, status = 0, chain, replace = false }) {
    try {

      if (!txTime) {
        console.error("ERROR: txTime is NULL txid:", txid)
      }
      if (replace) {
        replace = this.hasTransaction(txid)
      }
      const bytes = (chain == 'bsv' ? Buffer.from(rawtx, 'hex') : Buffer.from(rawtx))
      const sql = replace ? `update txs set bytes=?,txTime=?,status = ?, chain=? where txid = ? ` : `insert into txs (txid,bytes,txTime,status,chain) VALUES(?,?,?,?,?) `
      let ret = null
      if (replace) {
        ret = this.txdb.prepare(sql).run(bytes, txTime, status, chain, txid)
      } else {
        ret = this.txdb.prepare(sql).run(txid, bytes, txTime, status, chain)
      }

      if (oDataRecord)
        this.saveData({ data: oDataRecord.raw, owner: oDataRecord.owner, time: oDataRecord.ts, from: "addFullTx" })
    } catch (e) {
      console.error(e.message)
    }
    return true
  }

  setTxTime(txid, txTime) {
    const sql = `UPDATE txs SET txTime = ? WHERE txid = ?`
    this.txdb.prepare(sql).run(txTime, txid)
  }
  setTxStatus(txid, status) {
    const sql = `UPDATE txs SET status = ? WHERE txid = ?`
    this.txdb.prepare(sql).run(status, txid)
  }

  setTransactionResolved(txid, time, resolved = true) {
    const resolvedString = resolved ? TXRESOLVED_FLAG : "1"
    this.txdb.prepare(`UPDATE txs set resolved = ${resolvedString} where txid=?`).run(txid)
    const maxTime = +this.readConfig("dmdb", "maxResolvedTxTime")
    const maxResolvedTx = this.readConfig("dmdb", "maxResolvedTx")
    //console.log(maxTime, ":::", time)
    if (maxTime < time || (maxTime === time && maxResolvedTx > txid) || isNaN(maxTime)) {
      //console.log("here")
      this.writeConfig("dmdb", "maxResolvedTxTime", time.toString())
      this.writeConfig("dmdb", "maxResolvedTx", txid)
    }
  }
  setTransactionHeight(txid, height) {
    const sql = `UPDATE txs SET height = ? WHERE txid = ?`
    const ret = this.txdb.prepare(sql).run(height, txid)
  }

  setTransactionTime(txid, time) {
    const sql = `UPDATE txs SET time = ? WHERE txid = ?`
    this.txdb.prepare(sql).run(time, txid)
  }

  getRawTransaction(txid) {
    const sql = `SELECT bytes AS raw,chain FROM txs WHERE txid = ?`
    const row = this.txdb.prepare(sql).get(txid)
    const data = row && row.raw
    if (!data) return null
    if (row.chain == 'bsv') {
      return data.toString('hex')
    }
    if (row.chain == 'ar') {
      return data.toString()
    }
    console.error("database.js getRawTransaction: unsupported chain")
    return null
  }

  getTransactionTime(txid) {
    const sql = `SELECT txtime FROM txs WHERE txid = ?`
    const row = this.txdb.prepare(sql).raw(true).get(txid)
    return row && row[0]
  }

  getTransactionHeight(txid) {
    const sql = `SELECT height FROM txs WHERE txid = ?`
    const row = this.txdb.prepare(sql).raw(true).get(txid)
    return row && row[0]
  }

  deleteTransaction(txid) {
    const sql = "delete from txs where txid = ?"
    const ret = this.txdb.prepare(sql).run(txid)
    console.log("delete:", txid, "---", ret)
  }

  getTransactions({ time, limit, remove }) {
    if (!remove) remove = []
    const sql = `select txid,bytes,txTime from txs where txTime >= ? AND status!=1 ORDER BY txTime,txid ASC limit ?`
    let ret = this.txdb.prepare(sql).all(time, limit + remove.length)
    if (remove.length > 0) {
      ret = ret.filter(item => {
        for (const txid of remove) {
          if (item.txid === txid) return false
        }
        return true
      })
      ret = ret.slice(0, 100)
    }
    return ret
  }
  getTransaction(txid) {
    const sql = `select * from txs WHERE txid = ?`
    return this.txdb.prepare(sql).get(txid)
  }
  hasTransaction(txid) {
    const sql = `SELECT txid FROM txs WHERE txid = ?`
    return !!this.txdb.prepare(sql).get(txid)
  }
  isTransactionParsed(txid, andValid) {
    const sql = `SELECT txTime from txs WHERE txid = ?`
    const ret = this.txdb.prepare(sql).raw(true).get(txid)
    if (!ret || ret[0] == 0) return false
    if (andValid) return ret[0] != 1
    return true
  }
  getTransactionSigs(txid) {
    const sql = 'Select sigs from txs where txid=?'
    const ret = this.txdb.prepare(sql).get(txid)
    return ret && Util.parseJson(ret.sigs)
  }
  addTransactionSigs(txid, sigs) {
    try {
      if (typeof sigs === "string")
        sigs = Util.parseJson(sigs)
      if (!sigs) return false;
      let existing_sigs = this.getTransactionSigs(txid)
      if (!existing_sigs) existing_sigs = {}
      let dirty = false
      for (const key in sigs) {
        if (existing_sigs[key]) continue
        existing_sigs[key] = sigs[key]
        dirty = true
      }
      if (!dirty) return false
      const sql = 'Update txs set sigs = ? where txid=?'
      this.txdb.prepare(sql).run(JSON.stringify(existing_sigs), txid)
      //console.log("Added tx sigs txid:", txid, existing_sigs)
      return true
    } catch (e) {
    }
    return false
  }
  getConfirmations(txids) {
    try {
      let sql = "select sigs from txs where txid in (";
      for (const tx of txs) {
        txids.push(tx.txid)
        sql += "?,"
      }
      sql = sql.slice(0, sql.length - 1) + ")"
      const ret = this.txdb.prepare(sql).all(txids)
      return ret
    } catch (e) {
      return []
    }
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
  markResolvedTX() {
    const resolvedTX = this.readConfig("dmdb", "maxResolvedTx")

    if (resolvedTX) {
      const rTime = this.getTransactionTime(resolvedTX)
      while (true) {
        const arr = this.getUnresolvedTX(100, false)
        if (arr.length === 0) return
        for (const tx of arr) {
          if (tx.txTime > rTime || (tx.txTime === rTime && tx.txid > resolvedTX)) return
          this.txdb.prepare(`UPDATE txs set resolved = ${TXRESOLVED_FLAG} where txid=?`).run(tx.txid)
        }
      }
    }
  }
  getUnresolvedTX(count, mark = true) {
    try {
      if (mark)
        this.markResolvedTX()
      const sql = `SELECT * FROM txs WHERE status !=${DEF.TX_INVALIDTX} AND resolved !=${TXRESOLVED_FLAG} AND height >${this.resolvedHeight} ORDER BY txTime,txid ASC LIMIT ?`
      const list = this.txdb.prepare(sql).raw(false).all(count);

      return list;
    } catch (e) {
      console.error(e)
      return []
    }
  }
  loadDomain(domain, onlyDB = false) {
    let res = null
    if (!onlyDB) {
      res = MemDomains.get(domain)
      if (res) return res
    }
    res = this.getDomainStmt.get(domain);
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
  saveUsers(nidObj) {
    for (let name in nidObj.users) {
      const value = nidObj.users[name]
      if (name == "root") continue
      const sql = `insert or replace into users (account,address,attributes) VALUES(?,?,?) `
      try {
        const address = value.address
        const v1 = JSON.parse(JSON.stringify(value))
        delete v1.address
        this.dmdb.prepare(sql).run(name + "@" + nidObj.domain, address, JSON.stringify(v1))
      } catch (e) {
        console.error("saveUsers:", e.message)
      }
    }
  }
  readUser(account) {
    const sql = "select * from users where account = ?"
    const res = this.dmdb.prepare(sql).get(account)
    if (res && res.attributes) res.attributes = Util.parseJson(res.attributes)
    return res
  }
  getDataCount() {
    let sql = `select (select count(*) from txs) as txs`
    const ret = this.txdb.prepare(sql).get()
    sql = "select (select count(*) from nidobj) as domains , (select count(*) from keys) as keys"
    const ret1 = this.dmdb.prepare(sql).get()
    sql = "select (select count(*) from data) as odata"
    const ret2 = this.dtdb.prepare(sql).get()
    sql = "select (select value from config where key = 'domainUpdates') as 'DomainUpdates'"
    const ret3 = this.dmdb.prepare(sql).get()

    //count txs in blocks
    sql = "select body,height from blocks"
    let txsCount = 0
    const ret4 = this.txdb.prepare(sql).all()
    for (const item of ret4) {
      const txs = JSON.parse(item.body).txs
      txsCount += txs.length
    }
    const txHash = this.readConfig('txdb', 'statusHash')
    const dmHash = this.readConfig('dmdb', 'domainHash')
    const maxResolvedTx = this.readConfig('dmdb', 'maxResolvedTx')
    const maxResolvedTxTime = this.readConfig('dmdb', 'maxResolvedTxTime')
    return { v: 2, ...ret, ...ret1, ...ret2, ...ret3, txsBlocks: txsCount, blocks: ret4.length - 1, txHash, dmHash, maxResolvedTx, maxResolvedTxTime }
  }
  queryKeys({ v, num, tags, from }) {
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
      if (from) {
        sql += `AND ts > ${from} `
      }
    }
    sql += " order by ts";
    if (num) {
      sql += " limit " + num;
    }

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
  saveKeyHistory(nidObj, keyName, value) {
    try {
      this.dm_transaction(() => {
        if (nidObj.domain == "10200.test") {
          console.log("found")
        }

        const separator = ".";
        const lenKey = keyName + separator + nidObj.domain + "/len";
        let lenRet = this.readKeyStmt.get(lenKey);
        let count = 0;
        if (lenRet) count = +lenRet.value;
        count++;
        const tags = nidObj.keys[keyName].tags;
        this.saveKeysStmt.run(lenKey, count.toString(), null, 0, count.toString(), null, 0); //save len
        const hisKey = keyName + separator + nidObj.domain + "/" + count;
        this.saveKeysStmt.run(hisKey, JSON.stringify(value), tags, value.ts, JSON.stringify(value), tags, value.ts); //save len
        if (tags) {
          const tag1 = tags.split(';')
          tag1.map(tag => {
            this.saveTagStmt.run(tag, hisKey);
          })
        }
      })
    } catch (e) {
      this.logger.error(e)
    }
  }
  saveKeys(nidObj) {
    for (var item in nidObj.keys) {
      const keyName = item + "." + nidObj.domain;
      const tags = nidObj.keys[item].tags;
      if (tags) {
        console.log("tags:", tags)
      }
      const value = nidObj.keys[item];
      this.saveKeysStmt.run(keyName, JSON.stringify(value), tags, value.ts, JSON.stringify(value), tags, value.ts)
      if (this.tickers[keyName]) //notify subscribers
        this.tickers[keyName].broadcast('key_update', value)
    }
    /*for (var item in nidObj.users) {
      const value = JSON.stringify(nidObj.users[item]);
      const keyName = item + "@" + nidObj.domain;
      const tags = nidObj.tag_map[item + '@'];
      this.saveKeysStmt.run(keyName, value, tags, value, tags)
    }*/
  }
  subscribe(domain, session) {
    if (domain == "all") {
      this.tickerAll.register(session)
    } else {
      if (!this.tickers[domain]) this.tickers[domain] = createChannel()
      this.tickers[domain].register(session)
    }

  }
  findDomains(option) {
    let sql = ""
    if (option.address) {
      sql = 'SELECT domain FROM nidobj WHERE owner = ? '
      let ret = this.dmdb.prepare(sql).all(option.address);
      if (!ret) ret = []
      sql = 'SELECT account FROM users WHERE address = ? '
      return ret.concat(this.dmdb.prepare(sql).all(option.address));
    } else if (option.time) {
      const from = option.time.from ? option.time.from : 0
      const to = option.time.to ? option.time.to : 9999999999
      sql = 'SELECT domain FROM nidobj WHERE txCreate > ? AND txCreate < ? '
      const ret = this.dmdb.prepare(sql).all(from, to);
      if (!ret) ret = []
      return ret
    }
    return []
  }
  getSellDomains() {
    const sql = "SELECT jsonString from nidobj where jsonString like '%sell_info%' "
    const ret = this.dmdb.prepare(sql).all()
    let res = []
    for (const item of ret) {
      const obj = JSON.parse(item.jsonString)
      if (obj.sell_info.expire > Date.now()) {
        res.push({ domain: obj.domain, sell_info: obj.sell_info })
      }
    }
    return res;
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
  async saveDomainObj(obj) {
    try {
      if (!obj.owner) {
        console.error("no owner, pass")
        return
      }
      let domainHash = this.readConfig("dmdb", "domainHash")
      if (!domainHash) domainHash = ""
      domainHash = await Util.dataHash(JSON.stringify(obj) + domainHash)

      this.dm_transaction(() => {
        this.saveKeys(obj);
        this.saveTags(obj);
        this.saveUsers(obj);
        //this.saveNFT(obj);
        let sql = `INSERT INTO "nidobj" 
                (domain, txCreate,txUpdate,owner, owner_key, status, last_txid, jsonString, tld) 
                VALUES (?,?, ?,?, ?, ?, ?, ?, ?)
                ON CONFLICT( domain ) DO UPDATE
                SET txCreate=?,txUpdate=?,owner=? ,owner_key=?,status=?,last_txid=?,jsonString=?,tld=?`
        const txUpdate = obj.last_ts
        const txCreate = obj.reg_ts
        this.dmdb.prepare(sql).run(obj.domain, txCreate, txUpdate, obj.owner, obj.owner_key, obj.status, obj.last_txid, JSON.stringify(obj), obj.tld,
          txCreate, txUpdate, obj.owner, obj.owner_key, obj.status, obj.last_txid, JSON.stringify(obj), obj.tld)

        sql = "Update config set value = value+1 where key = 'domainUpdates'"
        this.dmdb.prepare(sql).run()

        this.writeConfig("dmdb", "domainHash", domainHash)

      })
      this.tickerAll.broadcast("key_update", obj)
    } catch (e) {
      console.log(obj)
      this.logger.error(e)
    }
  }

  async queryTX(fromTime, toTime, limit = -1) {
    try {
      if (toTime == -1) toTime = 9999999999
      let sql = `SELECT * from txs where (txTime > ? AND txTime < ? ) `
      if (limit != -1) sql += "limit " + limit
      //console.log(sql,fromTime,toTime)
      const ret = this.txdb.prepare(sql).all(fromTime, toTime)
      //console.log(ret)
      for (const item of ret) {
        const rawtx = item.bytes && (item.chain == 'bsv' ? item.bytes.toString('hex') : item.bytes.toString())
        item.rawtx = rawtx
        if (rawtx) {
          const attrib = await (Parser.getAttrib({ rawtx, chain: item.chain }));
          if (attrib && attrib.hash) {
            item.oDataRecord = this.readData(attrib.hash)
          }
        }
        delete item.bytes
      }
      return ret
    } catch (e) {
      console.error("queryTX:", e.message)
    }
    return []
  }
  //--------------------------------data service---------------------------
  writeToDisk(hash, buf, option) {
    const path = CONFIG.dataPath
    if (!fs.existsSync(path)) {
      path = __dirname + "/db/data/"
      console.error("DataPath does exist, using ", path)
    }
    const sub = hash.slice(0, 3)
    if (!fs.existsSync(Path.join(path, sub))) {
      fs.mkdir(Path.join(path, sub), { recursive: true })
    }
    fs.writeFileSync(Path.join(path, sub, hash), buf)
  }
  async saveData({ data, owner, time, from }) {
    let hash = null
    try {
      hash = await Util.dataHash(data)
      const buf = Util.toBuffer(data)
      console.log(`saving odata from ${from}.......hash:${hash}`)
      let sql = 'INSERT into data (hash,size,time,owner,raw) VALUES (?,?,?,?,?)'
      this.dtdb.prepare(sql).run(hash, buf.length, time, owner, buf)
    } catch (e) {
      console.log("Error Saving Data:", e.message, " hash:", hash)
    }
  }
  readDataFromDisk(hash, option) {
    const path = CONFIG.dataPath
    if (!fs.existsSync(path)) {
      path = __dirname + "/db/data/"
      console.error("DataPath does exist, using ", path)
    }
    const sub = hash.slice(0, 3)
    try {
      const data = fs.readFileSync(Path.join(path, sub, hash), option.string ? "utf-8" : null)
      return data
    } catch (e) {
      console.error("read data error hash:", hash, " code:", e.code)
    }
    return null
  }
  readData(hash, option = { string: true }) {
    let sql = 'SELECT * from data where hash = ?'
    const ret = this.dtdb.prepare(sql).get(hash)
    if (!ret) return {}
    if (ret.raw) {
      if (option.string) ret.raw = ret.raw.toString()
    }
    //ret.raw = this.readDataFromDisk(hash, option)
    return ret
  }
  writeConfig(dbName, key, value) {
    try {
      let db = null
      if (dbName == 'txdb') db = this.txdb
      if (dbName === 'dmdb') db = this.dmdb
      if (dbName === 'dtdb') db = this.dtdb
      const sql = 'insert or replace into config (key,value) values(?,?)'
      const ret = db.prepare(sql).run(key, value)
      //console.log(ret)
    } catch (e) {
      console.log(e.message)
    }
  }
  readConfig(dbName, key) {
    try {
      let sql = 'select value from config where key = ?'
      let db = null
      if (dbName == 'txdb') db = this.txdb
      if (dbName === 'dmdb') db = this.dmdb
      if (dbName === 'dtdb') db = this.dtdb
      if (db === null) {
        throw "db.readConfig: Invalid dbName"
        return
      }
      const ret = db.prepare(sql).get(key)
      return ret ? ret.value : ret
    } catch (e) {
      return null
    }
  }
  async verifyAllTXs() {
    let sql = 'select txid,chain from txs'
    const txs = this.txdb.prepare(sql).all()
    for (let tx of txs) {
      const full = this.getFullTx({ txid: tx.txid }).tx
      if (full.status !== 1) {
        this.setTxStatus(tx.txid, 0)
      }
    }
  }
  async verifyTxDB() {
    console.log("verifying...")
    await this.verifyAllTXs()
    console.log("verify finish")
  }
  async pullNewTx(afterHeight) {
    const uBlock = this.getBlock(afterHeight, true)
    if (uBlock) {
      const block = uBlock.block
      const tx = block.txs[block.txs.length - 1]
      return await this.queryTX(tx.txTime - 1, -1, 500)
    }
  }
  //------------------------------Blocks--------------------------------
  getLastBlock() {
    try {
      const sql = "SELECT * FROM blocks ORDER BY height DESC LIMIT 1"
      let block = this.txdb.prepare(sql).get()
      if (block) {
        block = { ...JSON.parse(block.body), hash: block.hash }
      }
      return block
    } catch (e) {
      console.error(e)
    }
    return null
  }
  getBlocks(from, to) {
    const sql = "select * from blocks where height >= ? AND height <= ?"
    const ret = this.txdb.prepare(sql).all(from, to)
    return ret
  }
  getBlock(height, uBlockType = false) {
    try {
      const sql = "select * from blocks where height=?"
      let block = this.txdb.prepare(sql).get(height)
      if (uBlockType && block) {
        return { block: { ...JSON.parse(block.body), hash: block.hash }, sigs: JSON.parse(block.sigs) }
      }
      return block
    } catch (e) {
      console.error(e)
    }
    return null
  }
  deleteTxs(txs) {
    try {
      let sql = "delete from txs where txid in (";
      const txids = []
      for (const tx of txs) {
        txids.push(tx.txid)
        sql += "?,"
      }
      sql = sql.slice(0, sql.length - 1) + ")"
      const ret = this.txdb.prepare(sql).run(txids)
      return ret
    } catch (e) {
      return false
    }
  }
  async getBlockTxs(height) {
    const BL = this.getBlock(height)
    if (!BL) return []
    const block = JSON.parse(BL.body)
    const ret = []
    if (block) {
      for (const tx of block.txs) {
        const txitem = await this.getFullTx({ txid: tx.txid })
        txitem && ret.push(txitem.tx)
      }
    }
    return ret
  }
  async saveBlock({ sigs, block }) {
    console.log("Saving block: " + block.height)
    try {
      const hash = block.hash
      delete block.hash
      const sql = "Insert into blocks (height,body,hash,sigs) values (?,?,?,?)"

      const statusHash = block.height == 0 ? null : this.readConfig('txdb', 'statusHash')
      const newStatus = statusHash ? await Util.dataHash(statusHash.value + hash) : hash

      //this.tx_transaction(() => {
      this.txdb.prepare(sql).run(block.height, JSON.stringify(block), hash, JSON.stringify(sigs))
      //set height of the tx
      const txs = block.txs
      for (const tx of txs) {
        //console.log("set txid:", tx.txid, " height:", block.height)
        this.setTransactionHeight(tx.txid, block.height)
      }
      this.txdb.prepare("insert or replace into config (key,value) VALUES('statusHash',?)").run(newStatus)
      this.txdb.prepare("insert or replace into config (key,value) VALUES('height',?)").run(block.height + '')
      //})
    } catch (e) {
      console.error("saveBlock:", e.message)
    }
  }
  deleteBlock(height) {
    try {
      const sql = "delete from blocks where height = ?"
      this.txdb.prepare(sql).run(height)
    } catch (e) {
      return false
    }
  }
  //------------------------------Nodes---------------------------------
  addNode({ url, info }) {
    try {
      const sql = "Insert or replace into nodes (url, info,pkey) values (?,?,?)"
      this.txdb.prepare(sql).run(url, JSON.stringify(info), info.pkey)
      return true
    } catch (e) {
      return false
    }
  }
  updateNodeScore(pkey, correct = true) {
    try {
      let sql = correct ? "UPDATE nodes SET correct = correct + 1 where pkey = ?" : "UPDATE nodes SET mistake = mistake + 1 where pkey = ?"
      this.txdb.prepare(sql).run(pkey)
      sql = "UPDATE nodes SET score = correct*100/(correct+mistake) where pkey = ?"
      this.txdb.prepare(sql).run(pkey)
    } catch (e) {
      return false
    }
    return true
  }
  getNode(pkey) {
    let sql = "select * from nodes where pkey = ?"
    return this.txdb.prepare(sql).get(pkey)
  }
  loadNodes() {
    try {
      const sql = "select * from nodes ORDER BY score,correct DESC"
      return this.txdb.prepare(sql).all()
    } catch (e) {
      return null
    }
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
