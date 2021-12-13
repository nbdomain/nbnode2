const { Parser_Domain } = require('./parser_domain')
const { AR_Parser_Domain } = require('./blockchains/ar_parser_domain')
const BitID = require("bitidentity");

const { DEF } = require("./def");
const { Parser_NFT } = require('./parser_nft');
const { AR_Parser_NFT } = require('./blockchains/ar_parser_nft');
const {ARChain, BSVChain} = require('./blockchains.js')

const parsers = {}
class Parser {
    static getParser(blockchain){
        if(blockchain=='bsv'){
            if(!parsers.bsv)parsers.bsv = new Parser('bsv')
            return parsers.bsv
        }
        if(blockchain=='ar'){
            if(!parsers.ar)parsers.ar = new Parser('ar')
            return parsers.ar
        }
            
        throw("Unsupported blockchain")
    }
    constructor(blockchain){
        this.blockchain = blockchain
        this.parser_domain = new Parser_Domain(blockchain)
        this.parser_nft = new Parser_NFT(blockchain)
    }
    init(db) {
        this.parser_domain.init(db)
        this.parser_nft.init(db)
    }
    verify(rawtx, height) {
        if(this.blockchain==='ar')return ARChain.verify(rawtx,height);
        if(this.blockchain==='bsv')return BSVChain.verify(rawtx,height);
        throw "Unsupported blockchain"
    }
    domainParser(){
        switch(this.blockchain){
            case 'bsv': return Parser_Domain
            case 'ar': return AR_Parser_Domain
        }
        return null
    }
    nftParser(){
        switch(this.blockchain){
            case 'bsv': return Parser_NFT
            case 'ar': return null
        }
        return null
    }
    parseRaw(rawtx, height,verify=false) {
        
        let rtx = ( this.blockchain==='ar'?ARChain.raw2rtx(rawtx,height):BSVChain.raw2rtx(rawtx,height) )
        try {
            let handler = this.domainParser().getAllCommands()[rtx.command]
            if (!handler) handler = this.nftParser().getAllCommands()[rtx.command]
            if (handler) rtx.output = handler.parseTX(rtx,verify)
            delete rtx.in
            delete rtx.out
            if (!rtx.output) {
                return { code: -1, msg: `Not a valid output: ${rtx.txid}` };
            }
        } catch (e) {
            console.error(e)
            rtx.output.err = e.message
        }
        return { code: 0, obj: rtx, msg: rtx.output.err ? rtx.output.err : "success" }
    }
    fillObj(nidObj, rtx, objMap) {
        let retObj = null
        nidObj.lastUpdateheight = rtx.height;
        nidObj.last_txid = rtx.txid
        if(rtx.txid=="5c23c8f8ed684ecb23b5a83b10507a4ef38de2fc3816acd0fdbbd312143dacda"){
            console.log("found")
        }
        if(rtx.output.err){
            return null
        }
        let handler = this.domainParser().getAllCommands()[rtx.command]
        if (!handler) handler = this.nftParser().getAllCommands()[rtx.command]
        if (handler) retObj = handler.fillObj(nidObj, rtx, objMap)
        else {
            console.error(rtx.command,":No handler found")
        }
        if (retObj == null) {
            console.error("Skipped one tx:", "msg:",rtx.output.err,rtx.command," txid:",rtx.txid)
            return null
        }
        console.log("applying cmd", rtx.command, " to:", nidObj.domain)
        return JSON.parse(JSON.stringify(retObj))
    }
}
module.exports = Parser