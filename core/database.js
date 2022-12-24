/**
 * database.js
 *
 * Layer between the database and the application
 */
const fs = require('fs')
const Sqlite3Database = require('better-sqlite3')
const Parser = require('./parser')
const mongoToSqlConverter = require("mongo-to-sql-converter")
const { Util } = require('./util')
const { createChannel } = require("better-sse")
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
const VER_DMDB = 12
const VER_TXDB = 5

// ------------------------------------------------------------------------------------------------
// Database
// ------------------------------------------------------------------------------------------------

class Database {
  constructor(path, logger, indexers) {
    //this.chain = chain
    this.path = path
    this.bkPath = Path.join(path, "backup")
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path);
    }
    if (!fs.existsSync(this.bkPath)) {
      fs.mkdirSync(this.bkPath);
    }
    this.dtfile = Path.join(path, "odata.db")
    this.txfile = Path.join(path, "txs.db")
    this.dmfile = Path.join(path, "domains.db")
    this.logger = logger
    this.txdb = null
    this.dmdb = null
    this.tickerAll = createChannel()
    this.tickers = {}
    this.onAddTransaction = null
    this.onDeleteTransaction = null
    this.onResetDB = null
    this.indexers = indexers
  }
  initdb(dbname) {
    if (dbname === 'txdb') {
      //--------------------------------------------------------//
      //  Transaction DB
      //-------------------------------------------------------//
      if (!this.txdb) {
        this.txdb = new Sqlite3Database(this.txfile, { fileMustExist: true })
        // 100MB cache
        this.txdb.pragma('cache_size = 6400')
        this.txdb.pragma('page_size = 16384')

        // WAL mode allows simultaneous readers
        this.txdb.pragma('journal_mode = WAL')

        // Synchronizes WAL at checkpoints
        this.txdb.pragma('synchronous = NORMAL')
      }
    }
    if (dbname === 'dmdb') {
      //--------------------------------------------------------//
      //  Domains DB
      //-------------------------------------------------------//
      if (!this.dmdb) {
        this.dmdb = new Sqlite3Database(this.dmfile, { fileMustExist: true })
        // 100MB cache
        this.dmdb.pragma('cache_size = 6400')
        this.dmdb.pragma('page_size = 16384')

        // WAL mode allows simultaneous readers
        this.dmdb.pragma('journal_mode = WAL')

        // Synchronizes WAL at checkpoints
        this.dmdb.pragma('synchronous = NORMAL')
      }

      //this.saveKeysStmt = this.dmdb.prepare(saveKeysSql);
      this.readKeyStmt = this.dmdb.prepare('SELECT * from keys where key=?')
      //this.saveTagStmt = this.dmdb.prepare(`INSERT INTO "tags" (tag, key) VALUES ( ?, ?)`)
      //this.deleteTagStmt = this.dmdb.prepare('DELETE FROM tags where "key"= ?')
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

      TXRESOLVED_FLAG = this.readConfig('dmdb', "TXRESOLVED_FLAG")
      if (!TXRESOLVED_FLAG) {
        TXRESOLVED_FLAG = Date.now()
        this.writeConfig('dmdb', "TXRESOLVED_FLAG", TXRESOLVED_FLAG + '')
      }
    }
    if (dbname === 'dtdb') {
      //----------------------------DATA DB----------------------------------
      this.dtdb = new Sqlite3Database(this.dtfile, { fileMustExist: true })
      // 100MB cache
      this.dtdb.pragma('cache_size = 6400')
      this.dtdb.pragma('page_size = 16384')
      // WAL mode allows simultaneous readers
      this.dtdb.pragma('journal_mode = WAL')
      // Synchronizes WAL at checkpoints
      this.dtdb.pragma('synchronous = NORMAL')
    }
  }
  open() {
    if (!this.txdb) {
      if (!fs.existsSync(this.txfile + "." + VER_TXDB)) {
        if (fs.existsSync(this.txfile)) {
          fs.unlinkSync(this.txfile)
          fs.unlinkSync(this.dmfile)
        }
        fs.writeFileSync(this.txfile + "." + VER_TXDB, "do not delete this file");
      }
      if (!fs.existsSync(this.dmfile + "." + VER_DMDB)) {
        if (fs.existsSync(this.dmfile)) {
          fs.unlinkSync(this.dmfile)
        }
        fs.writeFileSync(this.dmfile + "." + VER_DMDB, "do not delete this file");
      }

      if (!fs.existsSync(this.txfile)) {
        if (!fs.existsSync(this.txfile))
          fs.copyFileSync(Path.join(__dirname, "/template/txs.db"), this.txfile);
      }
      if (!fs.existsSync(this.dmfile)) {
        fs.copyFileSync(Path.join(__dirname, "/template/domains.db"), this.dmfile);
      }
      if (!fs.existsSync(this.dtfile)) {
        fs.copyFileSync(Path.join(__dirname, "/template/odata.db"), this.dtfile);
      }
      //const states = fs.statSync(this.dmfile + "." + VER_DMDB)
      //TXRESOLVED_FLAG = states.birthtimeMs
      this.initdb('txdb')
      this.initdb('dmdb')
      this.initdb('dtdb')
    }
    this.preDealData()
  }
  resetDB(type = 'domain') {
    if (type === 'domain') {
      const bkDBFile = Path.join(this.bkPath, "bk_domains.db")
      if (fs.existsSync(bkDBFile))
        fs.unlinkSync(bkDBFile)
      this.indexers.resolver.abortResolve()
      this.restoreLastGoodDomainDB()
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
        sql = "ALTER TABLE keys ADD domain text"
        this.dmdb.prepare(sql).run()
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

    sql = 'update txs set height = NULL'
    this.txdb.prepare(sql).run();
  }
  restoreDomainDB(filename) {
    console.log("Restoring domain DB from:", filename)
    this.dmdb.close()
    let isReset = false
    try {
      fs.unlinkSync(this.dmfile + '-shm')
    } catch (e) { }
    try {
      fs.unlinkSync(this.dmfile + '-wal')
    } catch (e) { }
    try {
      fs.unlinkSync(this.dmfile)
    } catch (e) { }

    if (fs.existsSync(filename)) {
      fs.copyFileSync(filename, this.dmfile)
    } else {
      fs.copyFileSync(Path.join(__dirname, "/template/domains.db"), this.dmfile);
      isReset = true
    }
    this.dmdb = null
    MemDomains.clearObj()
    this.initdb('dmdb')
    TXRESOLVED_FLAG = Date.now()
    this.writeConfig('dmdb', "TXRESOLVED_FLAG", TXRESOLVED_FLAG + '')
  }
  getResolvedFlag() {
    return this.txdb.prepare("select resolved from txs where resolved!=0").raw(true).get()
  }
  restoreTxDB(filename) {
    console.log("Restoring tx DB from:", filename)
    this.txdb.close()

    try {
      fs.unlinkSync(this.txfile + '-shm')
    } catch (e) { }
    try {
      fs.unlinkSync(this.txfile + '-wal')
    } catch (e) { }
    try {
      fs.unlinkSync(this.txfile)
    } catch (e) { }

    let restoreFile = filename
    if (!fs.existsSync(filename)) {
      restoreFile = Path.join(__dirname, "/template/txs.db")
    }
    console.log("restore:", restoreFile, "to:", this.txfile)
    fs.copyFileSync(restoreFile, this.txfile)
    this.txdb = null
    this.initdb('txdb')

  }
  restoreLastGoodDomainDB() {
    this.restoreDomainDB(Path.join(this.bkPath, "bk_domains.db"))
  }
  async backupDB() {
    //const { createGzip } = require('zlib');
    //const { pipeline } = require('stream');

    try {
      let dbname = Path.join(this.bkPath, `bk_domains.db`)

      if (fs.existsSync(dbname)) fs.unlinkSync(dbname)
      let sql = "VACUUM main INTO '" + dbname + "'"
      console.log("backup to:", dbname)
      this.dmdb.prepare(sql).run()

      dbname = Path.join(this.bkPath, `/bk_txs.db`)
      if (fs.existsSync(dbname)) fs.unlinkSync(dbname)
      sql = "VACUUM main INTO '" + dbname + "'"
      console.log("backup to:", dbname)
      this.txdb.prepare(sql).run()

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
  async updateTxHash({ txid, rawtx, txTime, oDataRecord }) {
    const stxPrint = JSON.stringify({ txid, rawtx, txTime, oDataRecord })
    const hash = await Util.dataHash(stxPrint)
    const txPrintHash = this.readConfig('txdb', 'txHash')
    const newHash = txPrintHash ? await Util.dataHash(txPrintHash.value + hash) : hash
    this.writeConfig('txdb', 'txHash', newHash)
  }
  async addFullTx({ txid, rawtx, txTime, oDataRecord, status = 0, chain, replace = false }) {
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
        await this.saveData({ data: oDataRecord.raw, owner: oDataRecord.owner, time: oDataRecord.ts, from: "addFullTx" })
      await this.updateTxHash({ txid, rawtx, txTime, oDataRecord })
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
    const sql = `select txid,bytes,txTime from txs where txTime >= ? AND status!=1 AND height IS NULL ORDER BY txTime,txid ASC limit ?`
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

  getUnresolvedTX(limit = 100) {
    try {
      //  let height = this.readConfig('dmdb', 'resolvingHeight')||0
      //  height = +height
      const maxResolvedTxTime = this.readConfig('dmdb', 'maxResolvedTxTime') || 0
      const sql = `SELECT * FROM txs WHERE status !=${DEF.TX_INVALIDTX} AND resolved !=${TXRESOLVED_FLAG} AND txTime>=${maxResolvedTxTime} ORDER BY txTime,txid ASC limit ${limit}`
      const list = this.txdb.prepare(sql).raw(false).all();
      /*if (list.length != 0) {
        height++
        this.writeConfig('dmdb', 'resolvingHeight', height + '')
      }*/
      return list
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
    let sql = `select (select count(*) from txs where status!=1) as txs`
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
  queryByTags(q) {
    const MongoDBQuery = `db.tags.find(${q},{key:1})`
    try {
      let SQLQuery = mongoToSqlConverter.convertToSQL(MongoDBQuery, true)
      SQLQuery = SQLQuery.slice(0, -1)
      const sql = `select key, value,ts from keys where key in(${SQLQuery})`
      const ret = this.dmdb.prepare(sql).all()
      return ret
    } catch (e) {
      return { code: 1, msg: e.message }
    }
  }
  async readKey(keyName) {
    try {
      //const keyLenName = keyName + "/len";
      const ret = this.readKeyStmt.get(keyName);
      if (ret) {
        let value = JSON.parse(ret.value);
        if (value.__shash) { //big value saved to data db
          const value1 = this.readData(value.__shash).raw
          if (!value1) {
            const d = await this.indexers.Nodes.getData(value.__shash)
            value = d.raw
          } else value = value1
        }
        return value;
      }
    } catch (e) {
      this.logger.error(e)
    }
    return null;
  }
  getAllKeys(domain) {
    const sql = 'select * from keys where domain= ?'
    const ret = this.dmdb.prepare(sql).all(domain)
    if (!ret) return {}
    let retKeys = {}
    for (const item of ret) {
      const k = item.key.split('.')
      k.pop(), k.pop()
      const key = k.join('.')
      retKeys[key] = Util.parseJson(item.value)
      retKeys[key].ts = item.ts
    }
    return retKeys
  }

  async saveKey({ key, value, domain, tags, ts }) {
    const fullKey = key + '.' + domain
    try {
      //set key
      if (value.length > DEF.MAX_VALUE_LEN) { //big value saved to data db
        const hash = await this.saveData({ data: value, owner: key, from: "saveKey" })
        if (hash) {
          value = JSON.stringify({ __shash: hash })
        }
      }
      let sql = "Insert or Replace into keys (key,value,domain,ts) values(?,?,?,?)"
      this.dmdb.prepare(sql).run(fullKey, value, domain, ts)
      //remove old tags
      sql = "delete from tags where key = ?"
      this.dmdb.prepare(sql).run(fullKey)
      //save tags
      if (typeof (tags) === 'object') {
        for (const tagName in tags) {
          sql = "Insert into tags (tagName,tagValue,key,domain,ts) values (?,?,?,?,?)"
          this.dmdb.prepare(sql).run(tagName, tags[tagName], fullKey, domain, ts)
        }
      }
      //update hash
      let domainHash = this.readConfig("dmdb", "domainHash")
      if (!domainHash) domainHash = ""
      const strObj = key + value + tags + ts
      domainHash = await Util.dataHash(strObj + domainHash)
      this.writeConfig("dmdb", "domainHash", domainHash)
      this.logger.logFile(domain, ":keyupdate dmhash:", domainHash)

    } catch (e) {
      console.error(e)
    }

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
      const strObj = JSON.stringify(obj)
      domainHash = await Util.dataHash(strObj + domainHash)

      this.dm_transaction(() => {
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
        this.logger.logFile(obj.domain, ":saveDomain dmhash:", domainHash)
        //if (obj.domain === "10200.test") {
        //  this.logger.logFile(strObj)
        //}

      })
      this.tickerAll.broadcast("key_update", obj)
    } catch (e) {
      console.log(obj)
      this.logger.error(e)
    }
  }
  getDomainVerifyCode() {
    return this.readConfig("dmdb", "domainHash")
  }
  saveDomainSigs(sigs) {
    this.writeConfig("dmdb", "domainSigs", sigs)
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
    const { config } = this.indexers
    const pp = config.dataPath
    if (!fs.existsSync(path)) {
      path = Path.join(__dirname, "/db/data/")
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
    return hash
  }
  readDataFromDisk(hash, option = { string: true }) {
    const { config } = this.indexers
    const path = config.dataPath
    if (!fs.existsSync(path)) {
      path = Path.join(__dirname, "/db/data/")
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
  async updaetAllTxHashes() {
    console.log("calculating all tx hashes...")
    this.writeConfig('txdb', 'txHash', null)
    let sql = 'select txid from txs'
    const txs = this.txdb.prepare(sql).all()
    for (let tx of txs) {
      const full = this.getFullTx({ txid: tx.txid })
      if (full.tx.status !== 1) {
        await this.updateTxHash({ txid: full.tx.txid, rawtx: full.tx.rawtx, txTime: full.tx.txTime, oDataRecord: full.oDataRecord })
      }
    }
    console.log("finish calculating. txHash:", this.readConfig('txdb', 'txHash'))
  }

  async verifyTxDB() {
    console.log("verifying...")
    await this.updaetAllTxHashes()
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
  getNodeScore(url) {
    try {
      let sql = "select correct,mistake,score from nodes where url = ?"
      return this.txdb.prepare(sql).get(url)
    } catch (e) {
    }
    return {}
  }
  removeNode(url) {
    try {
      let sql = "delete from nodes where url = ?"
      this.txdb.prepare(sql).run(url)
    } catch (e) {
    }
  }
  updateNodeScore(url, correct = true) {
    try {
      let sql = correct ? "UPDATE nodes SET correct = correct + 1 where url = ?" : "UPDATE nodes SET mistake = mistake + 1 where url = ?"
      this.txdb.prepare(sql).run(url)
      sql = "UPDATE nodes SET score = correct*100/(correct+mistake) where url = ?"
      this.txdb.prepare(sql).run(url)
      const score = this.getNodeScore(url)
      if (score.mistake > 20) {
        this.removeNode(url)
      }
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
