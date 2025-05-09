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
let objLen = obj => { return obj ? Object.keys(obj).length : 0 }

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
    const standalone = cfg_chain.tld_standalone_db ? cfg_chain.tld_standalone_db.split('&') : []
    this.standAloneTld = {}
    standalone.forEach(item => this.standAloneTld[item] = true)
    this.tldDef = {}
    this.dbHandles = {}
    this.tickerAll = createChannel()
    this.tickers = {}
    this.onAddTransaction = null
    this.onDeleteTransaction = null
    this.onResetDB = null
    this.indexers = indexers
    this.queries = {}
  }
  _initdbPara(filename, type) {
    if (!fs.existsSync(filename)) {
      if (type === 'domain') fs.copyFileSync(Path.join(__dirname, "/template/domains.db"), filename);
      if (type === 'tx') fs.copyFileSync(Path.join(__dirname, "/template/txs.db"), filename);
    }
    const db = new Sqlite3Database(filename, { fileMustExist: true })
    // 100MB cache
    db.pragma('cache_size = -200000')
    db.pragma('page_size = 16384')
    // WAL mode allows simultaneous readers
    db.pragma('journal_mode = WAL')
    // Synchronizes WAL at checkpoints
    db.pragma('synchronous = NORMAL')
    this.preDealDB(db, type)
    console.log(`[PID ${process.pid}] Opened DB: ${filename}`)
    return db
  }
  initdb(dbname) {
    const { config } = this.indexers
    if (dbname === 'txdb') {
      //--------------------------------------------------------//
      //  Transaction DB
      //-------------------------------------------------------//
      if (!this.txdb) {
        this.txdb = this._initdbPara(this.txfile, "tx")
      }
    }
    if (dbname === 'dmdb') {
      //--------------------------------------------------------//
      //  Init Domains DB
      //-------------------------------------------------------//
      const _createIndexer = ({ cols, table, tld, dbHandle }) => {
        for (const col of cols) {
          try {
            const colss = col.split('_');
            const sql = `CREATE INDEX index_${col}_${tld} ON ${table} ( ${colss.join(',')} )`
            dbHandle.prepare(sql).run()
          } catch (e) {
            console.error(e.message)
          }
        }
      }
      for (const key in config.dbs) {
        const db = config.dbs[key]
        const { file, tlds, tldKeysPerTable, gindex = [] } = db
        const dbHandle = this._initdbPara(Path.join(this.path, file), "domain")
        const arrTld = []
        tlds.forEach(item => arrTld.push(item.tld))
        this.dbHandles[key] = { handle: dbHandle, tlds: arrTld, name: key }
        if (key === 'main') this.dmdb = dbHandle
        let tabCreated = false
        gindex.push('verified')
        gindex.push('ts')
        for (const [index, tldInfo] of tlds.entries()) {
          let { tld, indexers = [] } = tldInfo
          this.tldDef[tld] = { handle: dbHandle, file, tabKeys: "keys" }
          let tabKeys = "keys"
          if (gindex) indexers = indexers.concat(gindex)
          if (index === 0 && indexers) {
            _createIndexer({ cols: indexers, table: tabKeys, tld, dbHandle })
          }
          if (tldKeysPerTable && index > 0) {
            tabKeys = `keys_${tld}`
            this.tldDef[tld].tabKeys = tabKeys
            try {
              let sql = "SELECT sql FROM sqlite_master WHERE name='keys'"
              let { sql: createSql } = dbHandle.prepare(sql).get()
              createSql = createSql.replace('keys', tabKeys)
              tabCreated = true
              dbHandle.prepare(createSql).run()
            } catch (e) {
              console.log(e.message)
            }
            if (indexers)
              _createIndexer({ cols: indexers, table: tabKeys, tld, dbHandle })
          }
        }
      }
      console.log("handlers:", this.dbHandles)
      TXRESOLVED_FLAG = this.readConfig('dmdb', "TXRESOLVED_FLAG")
      if (!TXRESOLVED_FLAG) {
        TXRESOLVED_FLAG = Date.now()
        this.writeConfig('dmdb', "TXRESOLVED_FLAG", TXRESOLVED_FLAG + '')
      }
    }
    if (dbname === 'dtdb') {
      //----------------------------DATA DB----------------------------------
      this.dtdb = this._initdbPara(this.dtfile, "data")
    }
  }
  getDomainDB({ key, tld = '' }) {
    if (this.tldDef == {} || (!key && !tld)) return { db: this.dmdb, tld }
    if (!tld) {
      const dd = key.split('.')
      tld = dd[dd.length - 1]
    }
    const tldInfo = this.tldDef[tld]
    if (!tldInfo) return { db: this.dmdb, tld, tab: "keys" }
    const { handle, tabKeys } = tldInfo
    return { db: handle, tld, tabKeys }
  }
  async getDBInfo(name) {
    let sql = "SELECT name FROM sqlite_master where type='table'"
    const db = this.dbHandles[name].handle
    const tables = await db.prepare(sql).raw(true).all()
    sql = "SELECT name FROM sqlite_master where type='index'"
    const indexs = await db.prepare(sql).raw(true).all()
    return { tables, indexs }
  }
  async showTable(name, table) {
    let sql = `SELECT * FROM ${table} limit 10`
    const db = this.dbHandles[name].handle
    const items = await db.prepare(sql).raw(true).all()
    sql = `select COUNT(*) from ${table} `
    const count = await db.prepare(sql).get()
    return { items, count }
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
  deleteDB({ name }) {
    let db = this.dbHandles[name].handle
    if (db) {
      db.close()
      fs.unlinkSync(db.name)
      fs.copyFileSync(Path.join(__dirname, "/template/domains.db"), db.name);
      const handle = this._initdbPara(db.name)
      for (const tld of this.dbHandles.tlds) {
        this.tldDef[tld].handle = handle
      }
    }
  }
  preDealDB(db, type) {
    let sql = ""
    if (type === 'domain') {
      try {
        //sql = 'ALTER TABLE keys DROP COLUMN verified'
        //db.prepare(sql).run()
        sql = 'ALTER TABLE keys ADD verified TEXT DEFAULT (0)'
        db.prepare(sql).run()
        //sql = 'ALTER TABLE nidobj DROP COLUMN verified'
        //db.prepare(sql).run()
        sql = `ALTER TABLE nidobj ADD verified TEXT DEFAULT (0)`
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
    const t1 = Date.now()
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
      const t2 = Date.now()
      //console.log("runPreparedSql:", name, sql, "time=", (t2 - t1) / 1000)
      return ret
    } catch (e) {
      console.error(e)
      console.error(sql, name)
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
    if (this.tldDef) {
      for (const tld in this.tldDef) {
        this.tldDef[tld].handle.close()
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
  async vacuumDMDB(name) {
    const db = this.dbHandles[name]
    db.handle.prepare("VACUUM").run()
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
      for (const tld in this.tldDef) {
        _backupDB(this.tldDef[tld].handle)
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
    let maxTxTime = +this.readConfig("txdb", "maxTxTime")
    if (!maxTxTime) {
      const sql = `SELECT txTime from txs where status!=1 ORDER BY txTime DESC`
      const res = this.runPreparedSql({ name: 'getLatestTxTime', db: this.txdb, method: 'get', sql })
      maxTxTime = res ? res.txTime : -1
    }

    return maxTxTime
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
      const maxTxTime = +this.readConfig("txdb", 'maxTxTime') || 0
      if (txTime > maxTxTime) {
        this.writeConfig("txdb", "maxTxTime", txTime)
      }
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
    const { db, tld, tabKeys } = this.getDomainDB({ key: domain })
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
  getDataCount({ domainKey = true, tx = false } = {}) {
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
        for (const tld in this.tldDef) {
          this._getDataDMST.push(this.tldDef[tld].handle.prepare(sql))
        }
      }
      let keys = 0, domains = 0
      for (const st of this._getDataDMST) {
        const res = st.get()
        keys += res.keys
        domains += res.domains
      }
      ret1 = { keys, domains }
    }

    // sql = "select (select count(*) from data) as odata"
    // odata && (ret2 = this.dtdb.prepare(sql).get())
    // sql = "select (select value from config where key = 'domainUpdates') as 'DomainUpdates'"
    // hash && (ret3 = this.dmdb.prepare(sql).get())

    /*const txHash = this.readConfig('txdb', 'statusHash')
    const dmHash = this.readConfig('dmdb', 'domainHash')
    const maxResolvedTx = this.readConfig('dmdb', 'maxResolvedTx')
    const maxResolvedTxTime = this.readConfig('dmdb', 'maxResolvedTxTime')
    const dmHashs = {}
    for (const tld in this.tldDef) {
      dmHashs[tld] = this.readConfig('dmdb-' + tld, 'domainHash')
    }*/
    return { v: 2, ...ret, ...ret1 }
  }

  queryChildCount(parent) {
    //const res = this.dmdb.prepare(sql).raw(true).get(parent)
    const { db, tld, tabKeys } = this.getDomainDB({ key: parent })
    const sql = `select count(*) from ${tabKeys} where parent = ?`
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
    if (item.props && item.parent) {
      //item.props_org = Object.assign({}, item.props)//structuredClone(item.props)
      const defination = await this.readKey('_def.' + item.parent)//get defination of this level
      if (defination) {
        for (let k in defination.v) {
          const df = defination.v[k].split(':')
          if (df[1] && df[1].indexOf('i') != -1) { //integer
            item.props[k] = +item.props[k]
          }
          if (df[1] && df[1].indexOf('o') != -1) { //object
            item.props[k] = Util.parseJson(item.props[k]) || {}
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
  async API_runQuery({ exp, para, method, tld }) {
    try {
      const { db } = this.getDomainDB({ tld })
      let ret = null
      switch (method) {
        case 'get': ret = db.prepare(exp).get(...para); break;
        case 'all': ret = db.prepare(exp).all(...para); break;
        case 'run': ret = db.prepare(exp).run(...para); break;
      }
      if (Array.isArray(ret)) {
        for (let i = 0; i < ret.length; i++) {
          ret[i] = await this.TransformOneKeyItem(ret[i])
        }
      } else {
        method != 'run' && ret && (ret = await this.TransformOneKeyItem(ret))
      }
      return ret
    } catch (e) {
      console.error(e.message)
    }
    return null
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
    //const ret = this.dmdb.prepare(sql).all(parentKey)
    const { db, tld, tabKeys } = this.getDomainDB({ key: parent })
    const sql = `select * from ${tabKeys} where parent = ?`

    const ret = this.runPreparedSql({ name: 'readChildrenKeys' + tld, db, method: 'all', sql, paras: [parent] })

    for (let i = 0; i < ret.length; i++) {
      ret[i] = await this.TransformOneKeyItem(ret[i])
    }
    return ret
  }
  async readKey(key, transform = true) {
    try {
      const { db, tld, tabKeys } = this.getDomainDB({ key })
      const sql = `SELECT * from ${tabKeys} where key=?`
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
    const { db, tld, tabKeys } = this.getDomainDB({ key: domain })
    const sql = `select * from ${tabKeys} where domain= ?`
    const ret = db.prepare(sql).all(domain)
    if (!ret) return {}
    for (let i = 0; i < ret.length; i++) {
      ret[i] = await this.TransformOneKeyItem(ret[i])
    }
    return ret
  }
  async delKey(key, ts, domain) {
    const { db, tld, tabKeys } = this.getDomainDB({ key })
    const sql = `replace into ${tabKeys} (key, value, ts, domain) values (?,'deleted',?,?)`

    const res = this.runPreparedSql({ name: "delKey" + tld, db, method: 'run', sql, paras: [key, ts, domain] })
  }
  async delChild(parent) {
    //const res = this.dmdb.prepare(sql).run(parent)
    const { db, tld, tabKeys } = this.getDomainDB({ key: parent })
    const sql = `DELETE from ${tabKeys} where parent = ?`

    const res = this.runPreparedSql({ name: "delChild" + tld, db, method: 'run', sql, paras: [parent] })
    console.log(res)
    return res
  }
  async saveKey({ key, value, domain, props = {}, tags, ts }) {
    const tmstart = Date.now()
    const fullKey = key + '.' + domain
    const parent = fullKey.slice(fullKey.indexOf('.') + 1)
    try {
      const { db, tld, tabKeys } = this.getDomainDB({ key: domain })
      let update = (props['_dbAction'] === 'update')
      delete props['_dbAction']
      let sql = `select * from ${tabKeys} where key = ?`
      let updateObj = null
      if (update) {
        updateObj = this.runPreparedSql({ name: 'saveKey0' + tld, db, method: 'get', sql, paras: [fullKey] })
        if (updateObj) {
          for (let k in updateObj) {
            if ((k.at(0) === 'p' || k.at(0) === 'u') && typeof (props[k]) != 'undefined') {
              if (typeof (props[k]) === 'string' && props[k].slice(0, 8) === '$append$') {
                const p = props[k].slice(8)
                updateObj[k] += p
              } else
                updateObj[k] = props[k]
            }
          }
          const vobj = Util.parseJson(value)
          const oldv = Util.parseJson(updateObj.value)
          if (typeof (vobj.v) === 'undefined') vobj.v = oldv.v
          else if (typeof (vobj.v) === 'string' && vobj.v.slice(0, 8) === '$append$') {
            const p = vobj.v.slice(8)
            vobj.v = oldv.v + p
          }
          updateObj.value = JSON.stringify(vobj)
        }
      }
      if (!updateObj)
        updateObj = { key: fullKey, value, domain, ts, parent, ...props }
      updateObj.ts = ts, updateObj.domain = domain, updateObj.parent = parent
      this.saveRawItem(updateObj, 'keys')
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
        let ret = db.prepare(sql).all(from, to);
        if (!ret) ret = []
        for (let i = 0; i < ret.length; i++) {
          ret[i] = await this.TransformOneKeyItem(ret[i])
        }
        return ret
      }
      return []
    }
    let ret = await _findDomains(this.dmdb, option)
    for (const tld in this.tldDef) {
      const ret1 = await _findDomains(this.tldDef[tld].handle, option)
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
    for (const tld in this.tldDef) {
      const ret1 = _getSellDomains(this.tldDef[tld].handle, option)
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
    let path = config.dataPath
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
          db = this.tldDef[tlds[1]]?.handle
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
          db = this.tldDef[tlds[1]]?.handle
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
  compactDMDB(dbname) {
    const sql = "SELECT name FROM sqlite_master where type='table'"
    let res = 0
    const dbInfo = this.dbHandles[dbname]
    if (!dbInfo) return { code: 100, err: "not found", dbname }
    const { handle } = dbInfo
    const names = handle.prepare(sql).raw(true).all()
    for (const name of names) {
      if (name[0].indexOf('keys') === 0) {
        const sqDelete = `delete from ${name[0]} where value='deleted'`
        res = handle.prepare(sqDelete).run()
        console.log(res)
      }
    }
    this.vacuumDMDB(dbname)
  }
  compactTXDB() {
    console.log("compacting txdb...")
    let ret = this.txdb.prepare("VACUUM").run()
    ret = this.dtdb.prepare("VACUUM").run()
    console.log("compacting txdb end")
  }
  removeOldTx() {
    let ret = null
    try {
      const { config, logger } = this.indexers
      const tmStart = Date.now()
      logger.console("removeOldTx started...")
      const daysToKeep = config?.txdb?.daysToKeep || 3
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
      logger.console("removeOldTx ends.Deleted:", hashToDel.length, " time:", (tmEnd - tmStart) / 1000)
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
    for (const tld in this.tldDef) {
      ret[tld] = _updateDBHash(this.tldDef[tld]?.handle, tld)
    }
    return ret
  }
  async deleteOldAsset() {
    console.log("deleting...")
    await this.delChild("golds.mxback.pv")
    console.log("deleting finish")
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

  async getUnverifiedItems({ count, type }) {
    const now = Date.now()
    let table = 'keys', ts = 'ts', colname = 'key'
    if (type === "domains") {
      table = 'nidobj', ts = 'txUpdate', colname = 'domain'
    }
    const result = {}

    const _inner = async (dbInfo) => {
      const { handle: db, tlds, name } = dbInfo
      let sql = `select * from ${table} where verified ='0' AND ${ts} < ?`
      let paras = [now - 10 * 1000]
      if (table === 'keys' && tlds.length > 1) {
        sql = `select * from ${table} where verified ='0' AND ${ts} < ? `
        for (const tld of tlds) {
          if (this.tldDef[tld].tabKeys != 'keys') {
            const tabKeys = this.tldDef[tld].tabKeys
            sql += `UNION ALL select * from ${tabKeys} where verified ='0' AND ${ts} < ? `
            paras.push(paras[0])
          }
        }
      }
      paras.push(count)
      sql += `limit ?`
      const ret = this.runPreparedSql({ name: "getUnverifiedItems" + type + name, db, method: "all", sql, paras })
      if (!ret) return null
      for (const item of ret) {
        delete item.verified, delete item.id
        result[item[colname]] = item
      }
    }
    /*await _inner(this.dmdb)
    for (const tld in this.tldDef) {
      await _inner(this.tldDef[tld].handle, tld)
    }*/
    for (const name in this.dbHandles) {
      const dbInfo = this.dbHandles[name]
      await _inner(dbInfo)
    }

    return Object.keys(result).length == 0 ? null : result
  }
  async getNewDm({ chainid, toVerify, tmstart, type, info, MaxCount = 500, from }) {
    const { config } = this.indexers

    let table = 'keys', ts = 'ts', colname = 'key'
    if (type === "domains") {
      table = 'nidobj', ts = 'txUpdate', colname = 'domain'
    }
    if (from === 'http://34.195.2.150:19000' && type === 'keys') {
      console.log("found")
    }
    if (chainid != config.chainid) {
      return { code: 100, msg: "unsupported chain" }
    }
    let ret = {}
    const result = {}
    if (toVerify) {
      ret = await this.verifyIncomingItems({ items: toVerify, type, from })
    }
    const _inner = async (dbInfo) => {
      //const sql = `select * from ${table} where ${ts} > ? OR (${ts} < ? AND verified = '0' ) ORDER BY ${ts} ASC limit ${MaxCount}`
      const { handle: db, tlds, name } = dbInfo
      let sql = `select * from ${table} where ${ts} > ? OR (${ts} < ? AND verified = '0' ) ORDER BY ${ts} ASC limit ${MaxCount}`
      let paras = [tmstart, tmstart]
      if (table === 'keys' && tlds.length > 1) {
        sql = `select * from keys where ${ts} > ? OR (${ts} < ? AND verified = '0' ) `
        for (const tld of tlds) {
          if (this.tldDef[tld].tabKeys != 'keys') {
            const tabKeys = this.tldDef[tld].tabKeys
            sql += `UNION ALL select * from ${tabKeys} where ${ts} > ? OR (${ts} < ? AND verified = '0' ) `
            paras.push(tmstart)
            paras.push(tmstart)
          }
        }
        sql += `ORDER BY ${ts} ASC limit ${MaxCount}`
      }
      const ret = this.runPreparedSql({ name: "getNewDm" + type + name + MaxCount, db, method: "all", sql, paras })
      if (!ret) return null
      //console.error("getNewDm ret len=", ret.length, "MaxCount=", MaxCount, "from=", from, "type=", type)
      let maxTime = 0
      for (const item of ret) {
        delete item.verified, delete item.id
        result[item[colname]] = item
        maxTime = Math.max(maxTime, item[ts])
      }
      return { maxTime, count: ret.length }
    }
    const tldMaxTime = []
    //const { maxTime, count } = await _inner({ db: this.dmdb })
    /*for (const tld in this.tldDef) {
      const ret1 = await _inner({ db: this.tldDef[tld].handle, tld })
      if (ret1.maxTime != 0)
        tldMaxTime.push(ret1.maxTime)
    }*/
    for (const name in this.dbHandles) {
      const dbInfo = this.dbHandles[name]
      const ret1 = await _inner(dbInfo)
      if (ret1.maxTime != 0)
        tldMaxTime.push(ret1.maxTime)
    }
    if (info === 'keycount') {
      const data_count = this.getDataCount({ domainKey: true })
      ret.keys = data_count.keys
      ret.domains = data_count.domains
    }
    ret.result = result
    ret.maxTime = objLen(result) < MaxCount ? Date.now() : Math.min(...tldMaxTime)

    if (ret.maxTime < 1685969396173) {
      console.log('found1')
    }
    return ret
  }
  incVerifyCount(item, type) {
    let table = 'keys', keyname = 'key'
    if (type === "domains") {
      table = 'nidobj', keyname = 'domain'
    }
    const key = item[keyname]
    const { db, tld, tabKeys } = this.getDomainDB({ key })
    if (table === 'keys') table = tabKeys
    const sql = `update ${table} set verified = verified + 1 where ${keyname} = ?`
    const ret = this.runPreparedSql({ name: "incVerifyCount1" + type + tld, db, method: "run", sql, paras: [key] })
    return ret
  }

  async pullNewDomains() {
    const { Nodes, axios, config } = this.indexers
    const types = ['domains', 'keys']
    const MaxCount = 500
    const chainid = config.chainid
    if (!this.pullCounter) this.pullCounter = 1
    if (this.pullCounter++ > 100) this.pullCounter = 1
    if (this.pullCounter % 6 === 0) {
      this.removeOldTx()
    }
    const _inner = async (peer, type, toVerify) => {
      try {
        const url = config.server.publicUrl
        const lastTimeKey = peer.url + "_lasttm" + type
        let lastTime = +this.readConfig('dmdb', lastTimeKey) || 0
        const res = await axios.post(peer.url + "/api/getNewDm", { chainid, toVerify, tmstart: lastTime, type, from: url, info: "keycount", MaxCount })
        const { result, keys, domains, maxTime, diff: diff1 } = res?.data
        if (res.data == 'not allowed') {
          console.error('pullNewDomains: not allowed', peer.url)
          return
        }
        const count = objLen(result)
        const synced = (count === 0 ? "Synced" : "")
        console.log(peer.url, ` ${type} ${synced}----- Count:`, objLen(result), "Keys:", keys, "Domains:", domains, "maxTime:", maxTime, " tmstart:", lastTime)
        if (type == 'keys') {
          //console.log('found')
        }
        if (objLen(toVerify) > 0 && diff1 != undefined)
          this.handleUnverifiedItems({ items: toVerify, diff: diff1, type })
        if (count === 0) {
          return
        }

        const { diff } = await this.verifyIncomingItems({ items: result, type, from: peer.url })
        if (count < MaxCount && objLen(diff) === 0) {
          console.log(peer.url, " " + type + " synced")
        }
        if (maxTime)
          this.writeConfig('dmdb', lastTimeKey, maxTime + '')
      } catch (e) {
        console.error(peer.url + ":", e.message)
      }
    }
    const tasks = []
    const res = this.getDataCount({ domainKey: true })
    console.log(`--------got from `, "MYSELF", "Keys:", res.keys, "Domains:", res.domains)
    for (const type of types) {
      const peers = Nodes.getNodes()
      const toVerify = await this.getUnverifiedItems({ count: 200, type })
      for (let k in peers) {
        const peer = peers[k]
        tasks.push(_inner(peer, type, toVerify))
      }
    }
    const ret = await Promise.allSettled(tasks)
    console.log("************************")

    setTimeout(this.pullNewDomains.bind(this), 10000);
  }
  handleUnverifiedItems({ diff, items, type }) {
    let table = 'keys', colname = 'key', ts = 'ts'
    if (type === "domains") {
      table = 'nidobj', colname = 'domain', ts = 'txUpdate'
    }
    for (const kk in items) {
      const item = items[kk]
      const item1 = diff[kk]
      if (!item1) {
        this.incVerifyCount(item, type)
        continue
      }
      if (item1[ts] > item[ts]) {
        this.saveRawItem(item1, type)
      }
    }
  }
  async fetchMissedItems(items, type, url) {
    const { axios } = this.indexers
    console.warn("fetchMissedItems count:", Object.keys(items).length, " from:", url)
    try {
      const ret = await axios.post(url + "/api/readRawItems", { items, type })
      console.warn("got:", objLen(ret.data))
      for (const key in ret.data) {
        const item = ret.data[key]
        this.saveRawItem(item, type)
      }
    } catch (e) {
      console.error("fetchMissedItems:", e.message)
    }
  }
  saveRawItem(item, type = 'keys') {
    let keyname = 'key'
    if (type === 'domains') {
      keyname = 'domain'
    }
    console.log("saving:", item[keyname])
    if (type === 'keys') {

      const { db, tld, tabKeys } = this.getDomainDB({ key: item.key })
      if (!tabKeys) {
        console.error("saveRawItem: unsupported domain:", item.key)
        return false
      }
      const sql = `Insert or Replace into ${tabKeys} (key,value,domain,ts,parent,p1,p2,p3,p4,p5,p6,p7,p8,p9,p10,p11,p12,p13,p14,p15,p16,p17,p18,p19,p20,u1,u2,u3,u4) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      const paras = [item.key, item.value, item.domain, item.ts, item.parent,
      item.p1, item.p2, item.p3, item.p4, item.p5, item.p6, item.p7, item.p8, item.p9, item.p10, item.p11, item.p12, item.p13, item.p14
        , item.p15, item.p16, item.p17, item.p18, item.p19, item.p20, item.u1, item.u2, item.u3, item.u4]
      return this.runPreparedSql({ name: 'saveKey1' + tld, db, method: 'run', sql, paras })
    }
    if (type === 'domains') {
      const obj = item
      const { db, tld } = this.getDomainDB({ key: obj.domain })
      this.saveUsers(obj);
      let sql = `INSERT INTO "nidobj" 
                (domain, txCreate,txUpdate,owner, owner_key, status, last_txid, jsonString, tld) 
                VALUES (?,?, ?,?, ?, ?, ?, ?, ?)
                ON CONFLICT( domain ) DO UPDATE
                SET txCreate=?,txUpdate=?,owner=? ,owner_key=?,status=?,last_txid=?,jsonString=?,tld=?`
      const txUpdate = obj.last_ts || obj.txUpdate
      const txCreate = obj.reg_ts || obj.txCreate
      delete obj.jsonString
      const paras = [obj.domain, txCreate, txUpdate, obj.owner, obj.owner_key, obj.status, obj.last_txid, JSON.stringify(obj), obj.tld,
        txCreate, txUpdate, obj.owner, obj.owner_key, obj.status, obj.last_txid, JSON.stringify(obj), obj.tld]
      return this.runPreparedSql({ name: 'saveDomainObj' + tld, db, method: 'run', sql, paras })
    }
  }

  async readRawItems(items, type) {
    const ret = {}
    let table = 'keys', keyname = 'key'
    if (type === "domains") {
      table = 'nidobj', keyname = 'domain'
    }
    for (const key in items) {
      const item = items[key]
      if (type === 'keys') {
        ret[key] = await this.readKey(item.key, false)
      }
      if (type === 'domains') {
        ret[key] = await this.loadDomain(item.domain, true, true)
      }
    }
    return ret
  }
  async verifyIncomingItems({ items, type, from, info }) {
    let table = 'keys', colname = 'key', ts = 'ts'
    if (type === "domains") {
      table = 'nidobj', colname = 'domain', ts = 'txUpdate'
    }
    let maxTime = 0
    const ret = { diff: {} }, missed = {}
    for (const kk in items) {
      const item = items[kk]
      maxTime = Math.max(maxTime, item[ts])
      let { db, tld, tabKeys } = this.getDomainDB({ key: kk })
      if (!tabKeys) {
        console.error("verifyIncomingItems: unsupported domain:", kk)
        continue
      }
      if (type === 'domains') tabKeys = table
      const sql = `select * from ${tabKeys} where ${colname} = ?`
      const item_my = await this.runPreparedSql({ name: "verifyItems" + table + tld, db, method: 'get', sql, paras: [kk] })
      if (!item_my) {
        missed[kk] = item
        continue
      }
      const verified = item_my.verified
      delete item_my.verified, delete item_my.id
      const hash = Util.fnv1aHash(JSON.stringify(item_my))
      const hash1 = Util.fnv1aHash(JSON.stringify(item))
      if (hash !== hash1) {
        if (item[ts] < item_my[ts]) ret.diff[kk] = item_my //incoming is older
        else missed[kk] = item //incoming is newer, add to fetch list
      }
      else {
        !verified && this.incVerifyCount(item, type)
      }
    }
    ret.miss = missed
    if (info === 'keycount') {
      ret.keys = this.getDataCount({ domainKey: true }).keys
    }
    ret.maxTime = maxTime
    if (Object.keys(missed).length > 0) {
      for (const key in missed) {
        const item = missed[key]
        this.saveRawItem(item, type)
      }
      //this.fetchMissedItems(missed, type, from)
    }
    return ret
  }
}

module.exports = Database
