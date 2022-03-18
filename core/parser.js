const { Parser_Domain } = require('./parser_domain')
const { Parser_NFT } = require('./parser_nft');
const {ARChain, BSVChain} = require('./chains.js')

const parsers = {}
class Parser {
    static getParser(chain){
        if(chain=='bsv'){
            if(!parsers.bsv)parsers.bsv = new Parser('bsv')
            return parsers.bsv
        }
        if(chain=='ar'){
            if(!parsers.ar)parsers.ar = new Parser('ar')
            return parsers.ar
        }
        throw("Unsupported chain")
    }
    constructor(chain){
        this.chain = chain
        this.parser_domain = new Parser_Domain(chain)
        this.parser_nft = new Parser_NFT(chain)
    }
    init(db) {
        this.parser_domain.init(db)
        this.parser_nft.init(db)
    }
    async verify(rawtx, height,block_time) {
        if(this.chain==='ar')return await ARChain.verify(rawtx,height,block_time);
        if(this.chain==='bsv')return await BSVChain.verify(rawtx,height,block_time);
        throw "Unsupported chain"
    }
    domainParser(){
        /*switch(this.chain){
            case 'bsv': return Parser_Domain
            case 'ar': return AR_Parser_Domain
        }
        return null*/
        return this.parser_domain
    }
    nftParser(){
       /* switch(this.chain){
            case 'bsv': return Parser_NFT
            case 'ar': return null
        }*/
        return this.parser_nft
    }
    async parseRaw({rawtx, height,time,verify=false}) {
        
        let rtx = ( this.chain==='ar'? await ARChain.raw2rtx({rawtx,height,time}): await BSVChain.raw2rtx({rawtx,height,time}) )
        try {
            if(!rtx){
                return {code:1,msg:"invalid rawtx format"}
            }
            if(verify&&height==-1){ //p2p rawtx
                const tspan = Date.now()/1000 - rtx.ts
                if(tspan>60||tspan<-1){
                    console.error("invalid timestamp")
                    return {code:1,msg:"invalid timestamp"}
                }
            }
            let handler = this.domainParser().getHandler(rtx.command)
            if (!handler) handler = this.nftParser().getHandler(rtx.command)
            if (handler) rtx.output = await handler.parseTX(rtx,verify)
            delete rtx.in
            delete rtx.out
            if (!rtx.output) {
                return { code: -1, msg: `Not a valid output: ${rtx.txid}` };
            }
        } catch (e) {
            console.error(e)
            if(!rtx.output)rtx.output={}
            rtx.output.err = e.message
        }
        return { code: 0, obj: rtx, msg: rtx.output.err ? rtx.output.err : "success" }
    }
    async fillObj(nidObj, rtx, objMap) {
        let retObj = null
        nidObj.lastUpdateheight = rtx.height;
        nidObj.last_txid = rtx.txid
        if(rtx.txid=="5c23c8f8ed684ecb23b5a83b10507a4ef38de2fc3816acd0fdbbd312143dacda"){
            console.log("found")
        }
        if(rtx.output.err){
            return null
        }
        let handler = this.domainParser().getHandler(rtx.command)
        if (!handler) handler = this.nftParser().getHandler(rtx.command)
        if (handler) retObj = await handler.fillObj(nidObj, rtx, objMap)
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