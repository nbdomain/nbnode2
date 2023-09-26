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
let wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

let TXRESOLVED_FLAG = 1, OTHER_RESOLVED_FLAG = 1
const VER_DMDB = 12
const VER_TXDB = 5

// ------------------------------------------------------------------------------------------------
// Database
// ------------------------------------------------------------------------------------------------


class Database {
  constructor(path, logger, indexers) {
    const { cfg_chain } = indexers
    this.path = path
    this.bkPath = Path.join(path, "../files")
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
    const standalone = cfg_chain.tld_standalone_db ? cfg_chain.tld_standalone_db.split('&') : []
    this.standAloneTld = {}
    standalone.forEach(item => this.standAloneTld[item] = true)
    this.tldDbs = {}
    this.tickerAll = createChannel()
    this.tickers = {}
    this.onAddTransaction = null
    this.onDeleteTransaction = null
    this.onResetDB = null
    this.indexers = indexers
    this.queries = {}
  }
  _initdbPara(filename, type) {
    const db = new Sqlite3Database(filename, { fileMustExist: true })
    // 100MB cache
    db.pragma('cache_size = 6400')
    db.pragma('page_size = 16384')
    // WAL mode allows simultaneous readers
    db.pragma('journal_mode = WAL')
    // Synchronizes WAL at checkpoints
    db.pragma('synchronous = NORMAL')
    this.preDealDB(db, type)
    return db
  }
  initdb(dbname) {
    if (dbname === 'txdb') {
      //--------------------------------------------------------//
      //  Transaction DB
      //-------------------------------------------------------//
      if (!this.txdb) {
        this.txdb = this._initdbPara(this.txfile)
      }
    }
    if (dbname === 'dmdb') {
      //--------------------------------------------------------//
      //  Domains DB
      //-------------------------------------------------------//
      if (!this.dmdb) {
        this.dmdb = this._initdbPara(this.dmfile, "domain")
      }
      TXRESOLVED_FLAG = this.readConfig('dmdb', "TXRESOLVED_FLAG")
      if (!TXRESOLVED_FLAG) {
        TXRESOLVED_FLAG = Date.now()
        this.writeConfig('dmdb', "TXRESOLVED_FLAG", TXRESOLVED_FLAG + '')
      }
      //other standalone TLD db
      for (const tld in this.standAloneTld) {
        if (!this.tldDbs[tld]) this.tldDbs[tld] = this._initdbPara(Path.join(this.path, "domains." + tld + ".db"), "domain")
      }
    }
    if (dbname === 'dtdb') {
      //----------------------------DATA DB----------------------------------
      this.dtdb = this._initdbPara(this.dtfile)
    }
  }
  getDomainDB({ key, tld }) {
    if (this.tldDbs == {} || (!key && !tld)) return { db: this.dmdb, tld: '' }
    if (!tld) {
      const dd = key.split('.')
      tld = dd[dd.length - 1]
    }
    if (this.tldDbs[tld]) return { db: this.tldDbs[tld], tld }
    return { db: this.dmdb, tld: '' }
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
        fs.copyFileSync(Path.join(__dirname, "/template/txs.db"), this.txfile);
      }
      if (!fs.existsSync(this.dmfile)) {
        fs.copyFileSync(Path.join(__dirname, "/template/domains.db"), this.dmfile);
      }
      if (!fs.existsSync(this.dtfile)) {
        fs.copyFileSync(Path.join(__dirname, "/template/odata.db"), this.dtfile);
      }
      for (const tld in this.standAloneTld) {
        const filename = Path.join(this.path, "domains." + tld + ".db")
        if (!fs.existsSync(filename)) {
          fs.copyFileSync(Path.join(__dirname, "/template/domains.db"), filename);
        }
      }
      this.initdb('txdb')
      this.initdb('dmdb')
      this.initdb('dtdb')
    }
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
  deleteDB({ type, name }) {
    if (type === 'tlddb') {
      let db = this.tldDbs[name]
      if (db) {
        db.close()
        fs.unlinkSync(db.name)
        fs.copyFileSync(Path.join(__dirname, "/template/domains.db"), db.name);
        this.tldDbs[name] = this._initdbPara(db.name)
      }
    }
  }
  preDealDB(db, type) {
    let sql = ""
    if (type === 'domain') {
      try {
        sql = 'ALTER TABLE keys ADD verified TEXT'
        db.prepare(sql).run()
        sql = `ALTER TABLE nidobj ADD verified TEXT`
        db.prepare(sql).run()
      } catch (e) { }
    }
  }
  preDealData() {
    try {
      let sql = ""

      try {
        for (let i = 1; i < 21; i++) {
          sql = `ALTER TABLE keys ADD p${i} TEXT`
          this.dmdb.prepare(sql).run()
        }
      } catch (e) { }


      try {
        sql = "ALTER TABLE txs ADD odata TEXT"
        this.txdb.prepare(sql).run()
      } catch (e) { }

      try {
        sql = `CREATE INDEX index_parent ON keys ( parent )`
        this.dmdb.prepare(sql).run()
      } catch (e) {
        //console.error(e.message)
      }
      try {
        sql = `CREATE INDEX index_p1 ON keys ( p1 )`
        this.dmdb.prepare(sql).run()
      } catch (e) {
        //console.error(e.message)
      }

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
  runPreparedSql({ name, db, method, sql, paras = [], update = false }) {
    //console.log("runPreparedSql:", sql, paras)
    try {
      if (!this.queries[name] || update) {
        this.queries[name] = db.prepare(sql)
      }
      let ret = null
      switch (method) {
        case 'get': ret = this.queries[name].get(...paras); break;
        case 'all': ret = this.queries[name].all(...paras); break;
        case 'run': ret = this.queries[name].run(...paras); break;
      }
      return ret
    } catch (e) {
      console.error(e.message)
    }
    return null
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
    if (this.tldDbs) {
      for (const tld in this.tldDbs) {
        this.tldDbs[tld].close()
      }
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
    const { logger } = this.indexers
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
    OTHER_RESOLVED_FLAG = this.readConfig('dmdb', "TXRESOLVED_FLAG") || 1
    TXRESOLVED_FLAG = Date.now()
    this.writeConfig('dmdb', "TXRESOLVED_FLAG", TXRESOLVED_FLAG + '')
    const checkpointTime = +this.readConfig("dmdb", "maxResolvedTxTime") || 0
    this.writeConfig('dmdb', 'checkpointTime', checkpointTime + '')
    const dmHash = this.readConfig('dmdb', 'domainHash')
    logger.info("Domain DB Restored from:", filename, " DomainHash:", dmHash, " OTHER_RESOLVED_FLAG:", OTHER_RESOLVED_FLAG)
  }
  getResolvedFlag() {
    return this.txdb.prepare("select resolved from txs where resolved!=0").raw(true).get()
  }
  restoreTxDB(filename) {
    console.log("Restoring tx DB from:", filename)
    const { logger } = this.indexers
    this.txdb.close()

    try {
      fs.unlinkSync(this.txfile + '-shm')
    } catch (e) {
      logger.error("restoreTxDB:", e.message)
    }
    try {
      fs.unlinkSync(this.txfile + '-wal')
    } catch (e) {
      logger.error("restoreTxDB:", e.message)
    }
    try {
      fs.unlinkSync(this.txfile)
    } catch (e) {
      logger.error("restoreTxDB:", e.message)
    }

    let restoreFile = filename
    if (!fs.existsSync(filename)) {
      restoreFile = Path.join(__dirname, "/template/txs.db")
    }
    try {
      console.log("restore:", restoreFile, "to:", this.txfile)
      fs.copyFileSync(restoreFile, this.txfile)
      this.txdb = null
      this.initdb('txdb')
    } catch (e) {
      logger.error("restoreTxDB:", e.message)
    }
    const dmHash = this.readConfig('dmdb', 'domainHash')
    logger.info("TX DB Restored from:", filename, " DomainHash:", dmHash)
  }
  restoreLastGoodDomainDB() {
    this.restoreDomainDB(Path.join(this.bkPath, "bk_domains.db"))
  }
  async backupDB() {
    try {
      const self = this
      const _backupDB = (db) => {
        const dbfile = db.name.split(Path.sep).slice(-1)
        const bkfile = Path.join(self.bkPath, dbfile[0] + ".bk")
        fs.rmSync(bkfile, { force: true })
        let sql = "VACUUM main INTO '" + bkfile + "'"
        console.log("backup to:", bkfile)
        db.prepare(sql).run()
      }
      const checkpointTime = +this.readConfig("dmdb", "maxResolvedTxTime") || 0
      this.writeConfig('dmdb', 'checkpointTime', checkpointTime + '')
      _backupDB(this.txdb)
      _backupDB(this.dmdb)
      for (const tld in this.tldDbs) {
        _backupDB(this.tldDbs[tld])
      }

      /*  let dbname = Path.join(this.bkPath, `bk_domains.db`)
  
        fs.rmSync(dbname, { force: true })
        let sql = "VACUUM main INTO '" + dbname + "'"
        console.log("backup to:", dbname)
        this.dmdb.prepare(sql).run()
        const checkpointTime = +this.readConfig("dmdb", "maxResolvedTxTime") || 0
        this.writeConfig('dmdb', 'checkpointTime', checkpointTime + '')
        dbname = Path.join(this.bkPath, `/bk_txs.db`)
        fs.rmSync(dbname, { force: true })
        sql = "VACUUM main INTO '" + dbname + "'"
        console.log("backup to:", dbname)
        this.txdb.prepare(sql).run()*/
      return { code: 0, msg: "success backup" }
    } catch (e) {
      console.error(e.message)
    }
    return { code: 100, msg: "error happened" }
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
    //const res = this.txdb.prepare(sql).get()
    const res = this.runPreparedSql({ name: 'getLatestTxTime', db: this.txdb, method: 'get', sql })
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
    ret.oDataRecord = tx.odata
    if (!ret.oDataRecord && ret.tx.rawtx) {
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
    let bytes = null
    try {
      if (!txTime) {
        console.error("ERROR: txTime is NULL txid:", txid)
      }
      if (replace) {
        replace = this.hasTransaction(txid)
      }
      bytes = (chain == 'bsv' ? Buffer.from(rawtx, 'hex') : Buffer.from(rawtx))
      const sql = replace ? `update txs set bytes=?,txTime=?,status = ?, chain=?,odata=? where txid = ? ` : `insert into txs (txid,bytes,txTime,status,chain,odata) VALUES(?,?,?,?,?,?) `
      let ret = null
      if (replace) {
        //ret = this.txdb.prepare(sql).run(bytes, txTime, status, chain, JSON.stringify(oDataRecord), txid)
        ret = this.runPreparedSql({ name: "addFullTx_update", db: this.txdb, method: "run", sql, paras: [bytes, txTime, status, chain, JSON.stringify(oDataRecord), txid] })
      } else {
        //ret = this.txdb.prepare(sql).run(txid, bytes, txTime, status, chain, JSON.stringify(oDataRecord))
        ret = this.runPreparedSql({ name: "addFullTx", db: this.txdb, method: "run", sql, paras: [txid, bytes, txTime, status, chain, JSON.stringify(oDataRecord)] })
      }

      await this.updateTxHash({ txid, rawtx, txTime, oDataRecord })
    } catch (e) {
      console.error(e.message)
    }
    return { txid, txTime, bytes, chain, odata: JSON.stringify(oDataRecord) }
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
    const maxTime = +this.readConfig("dmdb", "maxResolvedTxTime") || 0
    const maxResolvedTx = this.readConfig("dmdb", "maxResolvedTx")
    //console.log(maxTime, ":::", time)
    if (maxTime < time || (maxTime === time && maxResolvedTx > txid)) {
      this.writeConfig("dmdb", "maxResolvedTxTime", time + '')
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
    //const row = this.txdb.prepare(sql).get(txid)
    const row = this.runPreparedSql({ name: "getRawTransaction", db: this.txdb, method: 'get', sql, paras: [txid] })
    const data = row && row.raw
    if (!data) return null
    if (row.chain == 'bsv') {
      return data.toString('hex')
    }
    if (row.chain == 'ar' || row.chain == 'not') {
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
    //return this.txdb.prepare(sql).get(txid)
    return this.runPreparedSql({ name: 'getTransaction', db: this.txdb, method: 'get', sql, paras: [txid] })
  }
  hasTransaction(txid) {
    //const sql = `SELECT txid FROM txs WHERE txid = ?`
    return !!this.getTransaction(txid)
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
      const checkpointTime = this.readConfig('dmdb', 'checkpointTime') || 0
      const maxResolvedTx = this.readConfig('dmdb', 'maxResolvedTx') || ""
      //const sql = `SELECT * FROM txs WHERE status !=${DEF.TX_INVALIDTX} AND resolved !=${TXRESOLVED_FLAG} AND resolved !=${OTHER_RESOLVED_FLAG} AND txTime>=${checkpointTime} AND txid !='${maxResolvedTx}' ORDER BY txTime,txid ASC limit ${limit}`
      const sql = `SELECT * FROM txs WHERE status !=? AND resolved !=? AND resolved !=? AND txTime>=? AND txid !=? ORDER BY txTime,txid ASC limit ?`
      const list = this.runPreparedSql({ name: "lhmoxguy", db: this.txdb, sql, method: "all", paras: [DEF.TX_INVALIDTX, TXRESOLVED_FLAG, OTHER_RESOLVED_FLAG, checkpointTime, maxResolvedTx, limit] })
      return list
    } catch (e) {
      console.error(e)
      return []
    }
  }
  loadDomain(domain, onlyDB = false, raw = false) {
    let res = null
    if (!onlyDB) {
      res = MemDomains.get(domain)
      if (res) return res
    }
    //res = this.getDomainStmt.get(domain);
    const { db, tld } = this.getDomainDB({ key: domain })
    res = this.runPreparedSql({ name: "LoadDomain" + tld, db, method: 'get', sql: 'SELECT * from nidObj where domain = ?', paras: [domain] })
    if (!res) return null
    if (raw) return res
    return JSON.parse(res.jsonString);
  }
  queryTags(expression) {

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
        const { db, tld } = this.getDomainDB({ key: nidObj.domain })
        //this.dmdb.prepare(sql).run(name + "@" + nidObj.domain, address, JSON.stringify(v1))
        this.runPreparedSql({ name: 'saveuser' + tld, db, method: 'run', sql, paras: [name + "@" + nidObj.domain, address, JSON.stringify(v1)] })
      } catch (e) {
        console.error("saveUsers:", e.message)
      }
    }
  }
  readUser(account) {
    const sql = "select * from users where account = ?"
    //const res = this.dmdb.prepare(sql).get(account)
    const { db, tld } = this.getDomainDB({ key: account })
    const res = this.runPreparedSql({ name: 'readuser' + tld, db, method: 'get', sql, paras: [account] })

    if (res && res.attributes) res.attributes = Util.parseJson(res.attributes)
    return res
  }
  getDataCount({ tx = true, domainKey = true, odata = true, hash = true } = {}) {
    let { ret, ret1, ret2, ret3 } = {}
    let sql = `select (select count(*) from txs where status!=1) as txs`
    if (tx) {
      if (!this._getDataCountTxST) this._getDataCountTxST = this.txdb.prepare(sql)
      ret = this._getDataCountTxST.get()
    }
    sql = "select (select count(*) from nidobj) as domains , (select count(*) from keys) as keys"
    if (domainKey) {
      if (!this._getDataDMST) {
        this._getDataDMST = []
        this._getDataDMST.push(this.dmdb.prepare(sql))
        for (const tld in this.tldDbs) {
          this._getDataDMST.push(this.tldDbs[tld].prepare(sql))
        }
      }
      let keys = 0
      for (const st of this._getDataDMST) {
        keys += st.get().keys
      }
      ret1 = { keys }
    }
    // sql = "select (select count(*) from data) as odata"
    // odata && (ret2 = this.dtdb.prepare(sql).get())
    // sql = "select (select value from config where key = 'domainUpdates') as 'DomainUpdates'"
    // hash && (ret3 = this.dmdb.prepare(sql).get())

    const txHash = this.readConfig('txdb', 'statusHash')
    const dmHash = this.readConfig('dmdb', 'domainHash')
    const maxResolvedTx = this.readConfig('dmdb', 'maxResolvedTx')
    const maxResolvedTxTime = this.readConfig('dmdb', 'maxResolvedTxTime')
    const dmHashs = {}
    for (const tld in this.tldDbs) {
      dmHashs[tld] = this.readConfig('dmdb-' + tld, 'domainHash')
    }
    return { v: 2, ...ret, ...ret1, ...ret2, ...ret3, txHash, dmHash, dmHashs, maxResolvedTx, maxResolvedTxTime }
  }

  queryChildCount(parent) {
    const sql = "select count(*) from keys where parent = ?"
    //const res = this.dmdb.prepare(sql).raw(true).get(parent)
    const { db, tld } = this.getDomainDB({ key: parent })
    const res = this.runPreparedSql({ name: 'queryChildCount' + tld, db, method: 'get', sql, paras: [parent] })
    return { [parent]: Object.values(res)[0] }
  }
  async TransformOneKeyItem(item) {
    const plist = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'u1', 'u2', 'u3', 'u4', 'u5']
    delete item.id
    if (item.value === 'deleted') return null
    if (item.value) {
      const value = Util.parseJson(item.value)
      delete item.value
      item = { ...item, ...value }
    }
    for (const key in item) {
      const v = item[key]
      if (v === null) delete item[key]
      else {
        if (plist.indexOf(key) != -1) {
          item.props || (item.props = {})
          item.props[key] = v
          delete item[key]
        }
      }
    }
    //handle props convertion
    if (item.props) {
      //item.props_org = Object.assign({}, item.props)//structuredClone(item.props)
      const defination = await this.readKey('_def.' + item.parent)//get defination of this level
      if (defination) {
        for (let k in defination.v) {
          const df = defination.v[k].split(':')
          if (df[1] && df[1].indexOf('i') != -1) { //integer
            item.props[k] = +item.props[k]
          }
          Util.changeKeyname(item.props, k, df[0])
        }
      }
    }
    if (item.__shash) { //big value saved to data db
      let value = this.readData(item.__shash).raw
      if (!value) {
        const d = await this.indexers.Nodes.getData(item.__shash)
        value = d.raw
      }
      if (value) value = Util.parseJson(value)
      item.v = value?.v
      delete item.__shash
    }
    if (item.key)
      item.k = item.key.slice(0, item.key.indexOf(item.domain) - 1)
    return item
  }
  async API_runQuery({ exp, para, tld }) {
    try {
      const { db } = this.getDomainDB({ tld })
      let ret = db.prepare(exp).all(...para)
      if (!ret) return []
      for (let i = 0; i < ret.length; i++) {
        ret[i] = await this.TransformOneKeyItem(ret[i])
      }
      return ret
    } catch (e) {
      console.error(e.message)
    }
    return []
  }
  /*async mangoQuery(q) {
    try {
      const retCount = !!q.count
      if (q.count) q = q.count
      const tags = q.tags
      delete q.tags
      const limit = q.limit
      delete q.limit
      const orderby = q.orderby
      delete q.orderby
      let nokey = (Object.keys(q).length == 0)
      if (q.parent) { //within parent, convert props
        const defination = await this.readKey('_def.' + q.parent)//get defination of this level
        if (defination) {
          for (let k in defination.v) {
            const df = defination.v[k].split(':')
            Util.changeKeyname(q, df[0], k)
          }
        }
      }
      const MongoDBQuery = `db.keys.find(${JSON.stringify(q)})`
      let SQLQuery = mongoToSqlConverter.convertToSQL(MongoDBQuery, true)
      SQLQuery = SQLQuery.slice(0, -1)
      if (tags) {
        let tagsql = mongoToSqlConverter.convertToSQL(`db.tags.find(${JSON.stringify(tags)},{key:1})`, true)
        tagsql = tagsql.slice(0, -1)
        if (!nokey) SQLQuery += " AND "
        SQLQuery += "key in (" + tagsql + ")"
      }
      if (orderby) {
        SQLQuery += " ORDER BY " + orderby
      }
      if (limit)
        SQLQuery += " limit " + limit

      const ret = this.dmdb.prepare(SQLQuery).all()
      if (retCount) return ret.length
      for (let i = 0; i < ret.length; i++) {
        ret[i] = await this.handleOneKeyItem(ret[i])
      }
      return ret
    } catch (e) {
      return { code: 1, msg: e.message }
    }
  } */
  async readChildrenKeys(parent) {
    const sql = "select * from keys where parent = ?"
    //const ret = this.dmdb.prepare(sql).all(parentKey)
    const { db, tld } = this.getDomainDB({ key: parent })
    const ret = this.runPreparedSql({ name: 'readChildrenKeys' + tld, db, method: 'all', sql, paras: [parent] })

    for (let i = 0; i < ret.length; i++) {
      ret[i] = await this.TransformOneKeyItem(ret[i])
    }
    return ret
  }
  async readKey(key, transform = true) {
    try {
      const { db, tld } = this.getDomainDB({ key })
      const sql = 'SELECT * from keys where key=?'
      let ret = this.runPreparedSql({ name: "readKeyStmt" + tld, db, method: 'get', sql, paras: [key] })
      if (!ret) return null
      if (transform)
        ret = await this.TransformOneKeyItem(ret)
      //        delete ret.value
      return ret;
    } catch (e) {
      this.logger.error(e)
    }
    return null;
  }
  async getAllKeys(domain) {
    const sql = 'select * from keys where domain= ?'
    const { db, tld } = this.getDomainDB({ key: domain })
    const ret = db.prepare(sql).all(domain)
    if (!ret) return {}
    for (let i = 0; i < ret.length; i++) {
      ret[i] = await this.TransformOneKeyItem(ret[i])
    }
    return ret
  }
  async delKey(key, ts, domain) {
    //const sql = "DELETE from keys where key = ?"
    const sql = "replace into keys (key, value, ts, domain) values (?,'deleted',?,?)"

    //    const res = this.dmdb.prepare(sql).run(key)
    const { db, tld } = this.getDomainDB({ key })
    const res = this.runPreparedSql({ name: "delKey" + tld, db, method: 'run', sql, paras: [key, ts, domain] })
  }
  async delChild(parent) {
    const sql = "DELETE from keys where parent = ?"
    //const res = this.dmdb.prepare(sql).run(parent)
    const { db, tld } = this.getDomainDB({ key: parent })
    const res = this.runPreparedSql({ name: "delChild" + tld, db, method: 'run', sql, paras: [parent] })

    if (res.changes > 0) {
      /*  let domainHash = +this.readConfig("dmdb-" + tld, "domainHash") || 0
        const strObj = "delChild:" + parent
        const hash = +Util.fnv1aHash(strObj)
        domainHash ^= hash
        this.writeConfig("dmdb-" + tld, "domainHash", domainHash + '')
        this.logger.info(":del_child=", parent, " dmhash:", domainHash)*/
    }
  }
  async saveKey({ key, value, domain, props = {}, tags, ts }) {
    const tmstart = Date.now()
    const fullKey = key + '.' + domain
    const parent = fullKey.slice(fullKey.indexOf('.') + 1)
    try {
      const { db, tld } = this.getDomainDB({ key: domain })
      let sql = "select * from keys where key = ?"
      let updateObj = this.runPreparedSql({ name: 'saveKey0' + tld, db, method: 'get', sql, paras: [fullKey] })
      if (updateObj) {
        for (let k in updateObj) {
          if ((k.at(0) === 'p' || k.at(0) === 'u') && typeof (props[k]) != 'undefined') {
            if (props[k].slice(0, 7) === '$append') {
              const p = props[k].slice(8)
              updateObj[k] += p
            } else
              updateObj[k] = props[k]
          }
        }
        const vobj = Util.parseJson(value)
        const oldv = Util.parseJson(updateObj.value)
        updateObj.value = JSON.stringify({ v: vobj.v ? vobj.v : oldv.v, id: vobj.id })
      } else {
        updateObj = { key: fullKey, value, domain, ts, parent, ...props }
      }
      updateObj.ts = ts, updateObj.domain = domain, updateObj.parent = parent
      this.saveRawKeyItem(updateObj)
      //const paras = [fullKey, updateObj.value, domain, ts, parent, updateObj.p1, updateObj.p2, updateObj.p3, updateObj.p4, updateObj.p5, updateObj.p6, updateObj.p7, updateObj.p8, updateObj.p9, updateObj.p10, updateObj.p11, updateObj.p12, updateObj.p13, updateObj.p14, updateObj.p15, updateObj.p16, updateObj.p17, updateObj.p18, updateObj.p19, updateObj.p20, updateObj.u1, updateObj.u2, updateObj.u3, updateObj.u4, updateObj.u5]
      //this.runPreparedSql({ name: 'saveKey1' + tld, db, method: 'run', sql, paras })

      //remove old tags
      sql = "delete from tags where key = ?"
      db.prepare(sql).run(fullKey)
      //save tags
      if (typeof (tags) === 'object') {
        for (const tagName in tags) {
          sql = "Insert into tags (tagName,tagValue,key,domain,ts) values (?,?,?,?,?)"
          db.prepare(sql).run(tagName, tags[tagName], fullKey, domain, ts)
        }
      }
      //update hash
      /*let domainHash = +this.readConfig("dmdb-" + tld, "domainHash") || 0
      const hash = +Util.fnv1aHash(strObj)
      domainHash ^= hash
      this.writeConfig("dmdb-" + tld, "domainHash", domainHash + '')
      this.logger.info(domain, ":key=", key, ":value=", value, " dmhash:", domainHash)
      console.log("domainHash:", domainHash)*/
    } catch (e) {
      console.error(e)
    }
    const tmend = Date.now()
    console.log("savekey time:", (tmend - tmstart) / 1000)
  }
  subscribe(domain, session) {
    if (domain == "all") {
      this.tickerAll.register(session)
    } else {
      if (!this.tickers[domain]) this.tickers[domain] = createChannel()
      this.tickers[domain].register(session)
    }
  }

  async findDomains(option) {
    const _findDomains = async (db, option) => {
      let sql = ""
      if (option.address) {
        sql = 'SELECT domain FROM nidobj WHERE owner = ? '
        let ret = db.prepare(sql).all(option.address);
        if (!ret) ret = []
        sql = 'SELECT account FROM users WHERE address = ? '
        return ret.concat(db.prepare(sql).all(option.address));
      } else if (option.time) {
        const from = option.time.from ? option.time.from : 0
        const to = option.time.to ? option.time.to : 9999999999
        sql = 'SELECT domain FROM nidobj WHERE txCreate > ? AND txCreate < ? '
        const ret = db.prepare(sql).all(from, to);
        if (!ret) ret = []
        for (let i = 0; i < ret.length; i++) {
          ret[i] = await this.TransformOneKeyItem(ret[i])
        }
        return ret
      }
      return []
    }
    let ret = await _findDomains(this.dmdb, option)
    for (const tld in this.tldDbs) {
      const ret1 = await _findDomains(this.tldDbs[tld], option)
      ret = ret.concat(ret1)
    }
    return ret
  }
  getSellDomains() {
    const _getSellDomains = (db) => {
      const sql = "SELECT jsonString from nidobj where jsonString like '%sell_info%' "
      const ret = db.prepare(sql).all()
      let res = []
      for (const item of ret) {
        const obj = JSON.parse(item.jsonString)
        if (obj.sell_info.expire > Date.now()) {
          res.push({ domain: obj.domain, sell_info: obj.sell_info })
        }
      }
      return res;
    }
    let ret = _getSellDomains(this.dmdb, option)
    for (const tld in this.tldDbs) {
      const ret1 = _getSellDomains(this.tldDbs[tld], option)
      ret = ret.concat(ret1)
    }
    return ret
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
      const { db, tld } = this.getDomainDB({ key: obj.domain })

      let domainHash = +this.readConfig("dmdb-" + tld, "domainHash") || 0
      const strObj = JSON.stringify(obj)
      domainHash ^= Util.fnv1aHash(strObj)

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
        const paras = [obj.domain, txCreate, txUpdate, obj.owner, obj.owner_key, obj.status, obj.last_txid, JSON.stringify(obj), obj.tld,
          txCreate, txUpdate, obj.owner, obj.owner_key, obj.status, obj.last_txid, JSON.stringify(obj), obj.tld]
        this.runPreparedSql({ name: 'saveDomainObj' + tld, db, method: 'run', sql, paras })

        sql = "Update config set value = value+1 where key = 'domainUpdates'"
        this.runPreparedSql({ name: 'domainupdate', db: this.dmdb, method: 'run', sql })
        this.writeConfig("dmdb-" + tld, "domainHash", domainHash + '')
        this.logger.info(obj.domain, ":saveDomain dmhash:", domainHash)
      })
      this.tickerAll.broadcast("key_update", obj)
    } catch (e) {
      console.log(obj)
      this.logger.error(e)
    }
  }
  getDomainHash() {
    return this.readConfig("dmdb", "domainHash")
  }
  saveDomainSigs(sigs) {
    this.writeConfig("dmdb", "domainSigs", sigs)
  }
  async queryTX(fromTime, toTime, limit = -1) {
    try {
      if (toTime == -1) toTime = 9999999999999
      let sql = `SELECT * from txs where (txTime > ? AND txTime < ? ) limit ?  `
      //const ret = this.txdb.prepare(sql).all(fromTime, toTime, limit)
      const ret = this.runPreparedSql({ name: 'queryTX', db: this.txdb, method: 'all', sql, paras: [fromTime, toTime, limit] })
      for (const item of ret) {
        const rawtx = item.bytes && (item.chain == 'bsv' ? item.bytes.toString('hex') : item.bytes.toString())
        item.rawtx = rawtx
        item.oDataRecord = Util.parseJson(item.odata)
        delete item.odata
        if (rawtx && !item.oDataRecord) {
          const attrib = (Parser.getAttrib({ rawtx, chain: item.chain }));
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
    if (!data) return null
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
    //const ret = this.dtdb.prepare(sql).get(hash)
    const ret = this.runPreparedSql({ name: '', db: this.dtdb, method: 'get', sql, paras: [hash] })
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
      if (dbName === 'txdb') db = this.txdb
      else if (dbName === 'dtdb') db = this.dtdb
      else {
        const tlds = dbName.split('-')
        if (tlds[0] === 'dmdb') {
          db = this.tldDbs[tlds[1]]
          if (!db) db = this.dmdb
        }
      }
      const sql = 'insert or replace into config (key,value) values(?,?)'
      //const ret = db.prepare(sql).run(key, value)
      const ret = this.runPreparedSql({ name: 'writeconfig' + dbName, db, method: 'run', sql, paras: [key, value] })

      //console.log(ret)
    } catch (e) {
      console.log(e.message)
    }
  }
  readConfig(dbName, key) {
    try {
      let sql = 'select value from config where key = ?'
      let db = null
      if (dbName === 'txdb') db = this.txdb
      else if (dbName === 'dtdb') db = this.dtdb
      else {
        const tlds = dbName.split('-')
        if (tlds[0] === 'dmdb') {
          db = this.tldDbs[tlds[1]]
          if (!db) db = this.dmdb
        }
      }

      if (db === null) {
        throw "db.readConfig: Invalid dbName"
        return
      }
      //const ret = db.prepare(sql).get(key)
      const ret = this.runPreparedSql({ name: 'readconfig' + dbName, db, method: 'get', sql, paras: [key] })

      return ret ? ret.value : ret
    } catch (e) {
      return null
    }
  }
  compactTxDB() {
    let ret = null
    try {
      const { config, logger } = this.indexers
      const tmStart = Date.now()
      logger.console("compactTxDB started...")
      const daysToKeep = config?.txdb?.daysToKeep || 7
      const daysAgo = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000)
      let sql = "select txid, chain from txs where txTime<?"
      const txs = this.txdb.prepare(sql).all(daysAgo.getTime())
      const hashToDel = []
      for (const tx of txs) {
        const rawtx = this.getRawTransaction(tx.txid)
        if (rawtx) {
          const attrib = Parser.getAttrib({ rawtx, chain: tx.chain });
          if (attrib.hash) {
            hashToDel.push("'" + attrib.hash + "'")
          }
        }
      }
      for (let i = 0; i < hashToDel.length; i += 1000) {
        const sub = hashToDel.slice(i, i + 1000)
        sql = `delete from data where hash IN (${sub.join(', ')})`
        ret = this.dtdb.prepare(sql).run()
        console.log(ret)
      }

      sql = 'delete from txs where txTime < ?'
      ret = this.txdb.prepare(sql).run(daysAgo.getTime())
      const tmEnd = Date.now()
      logger.console("compactTxDB ends.Deleted:", hashToDel.length, " time:", (tmEnd - tmStart) / 1000)
    } catch (e) {
      console.error(e.message)
    }

  }
  async deleteData({ hash }) {
    try {
      const sql = 'delete from data where hash = ?'
      const ret = this.dtdb.prepare(sql).run(hash)
      return ret
    } catch (e) {
      console.log(e.message)
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
  updateAllDomainHashes() {
    const _updateDBHash = (db, tld) => {
      let dmHash = 0;
      let sql = 'select key, value, p1,p2,p3,p4,p5,p6,p7,p8,p9,p10,p11,p12,p13,p14,p15,p16,p17,p18,p19,p20,u1,u2,u3,u4,u5 from keys'
      const objs = db.prepare(sql).all()
      let i = 0
      for (const item of objs) {
        for (const k in item) {
          if (item[k] === null) delete item[k]
        }
        const str = JSON.stringify(item)
        const hash = Util.fnv1aHash(str)
        dmHash ^= hash
        //        console.log(i++, str, hash, dmHash)
      }
      sql = 'select jsonString from nidobj'
      const domains = db.prepare(sql).all()
      for (const str of domains) {
        const hash = Util.fnv1aHash(str.jsonString)
        console.log(i++, str.jsonString, hash, dmHash)
        dmHash ^= hash
      }
      this.writeConfig('dmdb-' + tld, 'domainHash', dmHash + '') // 1039166988
      console.log("updateAllDomainHashes finish dmHash:", dmHash)
      return { keys: objs.length, domains: domains.length, dmHash }
    }
    const ret = {}// _updateDBHash(this.dmdb)
    for (const tld in this.tldDbs) {
      ret[tld] = _updateDBHash(this.tldDbs[tld], tld)
    }
    return ret
  }
  async verifyTxDB() {
    console.log("verifying...")
    await this.updaetAllTxHashes()
    console.log("verify finish")
  }
  async getNewTx({ afterHeight, fromTime }) {
    let time = +fromTime || 0
    if (afterHeight) {
      const uBlock = this.getBlock(afterHeight, true)
      if (uBlock) {
        const block = uBlock.block
        const tx = block.txs[block.txs.length - 1]
        time = tx.txTime - 1
      }
    }
    const data = await this.queryTX(time - 1, -1, 500)
    //const sql = "select (select count(*) from nidobj) as domains , (select count(*) from keys) as keys"
    //const { db, tld } = this.getDomainDB({ key })
    //const ret1 = this.runPreparedSql({ name: 'getNewTx1', db: this.dmdb, method: 'get', sql })
    const ret1 = this.getDataCount({ domainKey: true })
    const dmHash = this.readConfig('dmdb-', 'domainHash')
    return { data, dmHash, ...ret1 }
  }
  async mangoTosql(q) {
    if (q.count) q = q.count
    const tags = q.tags
    delete q.tags
    const limit = q.limit
    delete q.limit
    const orderby = q.orderby
    delete q.orderby
    let nokey = (Object.keys(q).length == 0)
    if (q.parent) { //within parent, convert props
      const defination = await this.readKey('_def.' + q.parent)//get defination of this level
      if (defination) {
        for (let k in defination.v) {
          const df = defination.v[k].split(':')
          Util.changeKeyname(q, df[0], k)
        }
      }
    }
    const MongoDBQuery = `db.keys.find(${JSON.stringify(q)})`
    let SQLQuery = mongoToSqlConverter.convertToSQL(MongoDBQuery, true)
    SQLQuery = SQLQuery.slice(0, -1)
    if (tags) {
      let tagsql = mongoToSqlConverter.convertToSQL(`db.tags.find(${JSON.stringify(tags)},{key:1})`, true)
      tagsql = tagsql.slice(0, -1)
      if (!nokey) SQLQuery += " AND "
      SQLQuery += "key in (" + tagsql + ")"
    }
    if (orderby) {
      SQLQuery += " ORDER BY " + orderby
    }
    if (limit)
      SQLQuery += " limit " + limit
    SQLQuery = SQLQuery.replaceAll("'?'", "?")
    return SQLQuery
  }

  // select * from keys where parent = 'golds.mxback.pv' AND p1 = ? AND p3 = ? AND (p5>? AND p5<?) order by p5 DESC limit 50
  async API_execPreparedQuery({ name, sql, paras, method = 'get', transform = true, update = false }) {
    //const t1 = Date.now()
    const tld1 = name.split('-')[1]
    const { db, tld } = this.getDomainDB({ tld: tld1 })

    let ret = this.runPreparedSql({ name, db, method, sql, paras, update })
    if (transform) {
      if (Array.isArray(ret)) {
        for (let i = 0; i < ret.length; i++) {
          ret[i] = await this.TransformOneKeyItem(ret[i])
        }
      } else {
        method != 'run' && ret && (ret = await this.TransformOneKeyItem(ret))
      }
    }
    //const t2 = Date.now()
    //console.log("execQuery:", (t2 - t1) / 1000)
    return ret
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
        const txitem = this.getFullTx({ txid: tx.txid })
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
    //const res = this.getNFTStmt.get(symbol)
    const res = this.runPreparedSql({ name: "getNFT", db: this.dmdb, method: 'get', sql: 'SELECT * from nfts where symbol=?', paras: [symbol] })
    if (res) {
      res.attributes = JSON.parse(res.attributes)
      res.data = JSON.parse(res.data)
    }
    return res
  }
  // -----------------------------verify DB-------------------------------------------------------------------

  async getUnverifiedItems({ db, count, type }) {
    const now = Date.now()
    let table = 'keys', ts = 'ts'
    if (type === "domains") {
      table = 'nidobj', ts = 'lastUpdate'
    }
    const sql = `select * from ${table} where verified is NULL AND ${ts} < ? limit ?`
    const ret = db.prepare(sql).all(now - 10 * 1000, count)
    if (!ret) return null
    const result = []
    for (const item of ret) {
      delete item.verified
      const str = JSON.stringify(item)
      const hash = Util.fnv1aHash(str)
      result.push({ key: item.key, hash, ts: item.ts })
    }
    return result
  }
  async verifyDBFromPeers() {
    const { Nodes, axios, config } = this.indexers
    const type = 'keys'
    const items = await this.getUnverifiedItems({ db: this.dmdb, count: 100, type })
    if (items) {
      const peers = Nodes.getNodes()
      for (let k in peers) {
        const peer = peers[k]
        try {
          const ret = await axios.post(peer.url + "/api/verifyDMs", { items, type, from: config.server.publicUrl })
          console.log(ret.data)
        } catch (e) {
          console.error(e.message)
        }
      }
    }
  }
  async fetchMissedItems(items, type, url) {
    const { axios } = this.indexers
    const ret = await axios.post(url + "/api/readRawItems", { items, type })

    for (const item of ret.data) {
      this.saveRawKeyItem(item)
    }
  }
  saveRawKeyItem(item) {
    const sql = `Insert or Replace into keys (key,value,domain,ts,parent,
      p1,p2,p3,p4,p5,p6,p7,p8,p9,p10,p11,p12,p13,p14,p15,p16,p17,p18,p19,p20,u1,u2,u3,u4,u5) 
      values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    const { db, tld } = this.getDomainDB({ key: item.key })
    const paras = [item.key, item.value, item.domain, item.ts, item.parent,
    item.p1, item.p2, item.p3, item.p4, item.p5, item.p6, item.p7, item.p8, item.p9, item.p10, item.p11, item.p12, item.p13, item.p14
      , item.p15, item.p16, item.p17, item.p18, item.p19, item.p20, item.u1, item.u2, item.u3, item.u4, item.u5]
    this.runPreparedSql({ name: 'saveKey1' + tld, db, method: 'run', sql, paras })

  }
  async readRawItems(items, type) {
    const ret = []
    for (const item of items) {
      if (type === 'keys') {
        ret.push(await this.readKey(item.key, false))
      }
      if (type === 'domains') {
        ret.push(await this.loadDomain(item.domain, true, true))
      }
    }
    return ret
  }
  async verifyIncomingItems(items, type, from) {
    let table = 'keys', key = 'key'
    if (type === "domains") {
      table = 'nidobj', key = 'domain'
    }
    const ret = [], missed = []
    const sql = `select * from ${table} where ${key} = ?`
    for (const item of items) {
      const { db } = this.getDomainDB({ key: item.key })
      const item_my = await this.runPreparedSql({ name: "verifyItems" + table, db, method: 'get', sql, paras: [item.key] })
      if (!item_my) {
        missed.push(item)
        continue
      }
      delete item_my.verified
      const str = JSON.stringify(item_my)
      const hash = Util.fnv1aHash(str)
      if (hash !== item.hash) ret.push(item_my)
    }
    this.fetchMissedItems(missed, type, from)
    return ret
  }
}



module.exports = Database
