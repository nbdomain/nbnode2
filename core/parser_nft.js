const { Util, CMD_BASE } = require("./util.js");
const { CMD } = require("./def");

function isTesting(symbol){
    return symbol.slice(-8)=='.testing'
}
let bsvdb = null
class Parser_NFT {
    static getAllCommands() {
        return { [CMD.NFT_CREATE]: CMD_NFT_Create, [CMD.NFT_TRANSFER]: CMD_NFT_Transfer,
            [CMD.NFT_REFILL]: CMD_NFT_REFILL, [CMD.NFT_SELL]: CMD_NFT_SELL
        }
    }
    constructor(blockchain){
        this.blockchain = blockchain
    }
    init(db) {
        this.db = db
        bsvdb = db
    }
}

class CMD_NFT_Create {
    static parseTX(rtx) {
        let output = CMD_BASE.parseTX(rtx);
        const obj = JSON.parse(rtx.out[0].s5)
        output.symbol = Object.keys(obj)[0]
        output.attributes = obj[output.symbol].attributes
        output.data = obj[output.symbol].data
        output.attributes.contract = rtx.txid
        const testing = isTesting(output.symbol)
        const nft = bsvdb.getNFT(output.symbol)
        if (nft && !testing) {
            output.err = `The symbol: ${output.symbol} is taken. Please use another one`
            return output
        }
        if (!testing) { //check payment for production NFT
            output.fee = rtx.out[3].e.v
            output.pay = rtx.out[3].e.a
            let adminAddr = Util.getTLDFromRegisterProtocol(output.protocol)[1];
            if (output.pay != adminAddr) {
                output.err = "nft.create failed, payment address incorrect."
            }
        }
        return output
    }
    static _addLog(nidObj, rtx) {
        const symbol = rtx.output.symbol
        if (!nidObj.nft_log) nidObj.nft_log = {}
        if (!nidObj.nft_log[symbol]) nidObj.nft_log[symbol] = ""
        nidObj.nft_log[symbol] += `${[rtx.command]}: ${rtx.txid}, time: ${+Date.now() / 1000} \n`
    }
    static fillObj(nidObj, rtx) {
        if (nidObj.owner_key == null || nidObj.owner_key != rtx.publicKey) return null
        const symbol = rtx.output.symbol
        const testing = isTesting(symbol)
        const nft = bsvdb.getNFT(symbol)
        if (nft && !testing){
            rtx.output.err = `${symbol} existed. Please use a new symbol`
            return null
        }
        rtx.output.attributes.creator_id = nidObj.domain
        //if (!nidObj.nft_create) nidObj.nft_create = {}
        //nidObj.nft_create[symbol] = rtx.output
        bsvdb.nftCreate(rtx.output) //create or update the NFT
        if (!nidObj.nfts) nidObj.nfts = {};
        nidObj.nfts[symbol] = { "0": { amount: rtx.output.attributes.supply } }
        CMD_NFT_Create._addLog(nidObj, rtx)
        return nidObj
    }
}
class CMD_NFT_Transfer {
    static parseTX(rtx, verify) {
        let output = CMD_BASE.parseTX(rtx);
        try {
            const trans = JSON.parse(rtx.out[0].s5)
            const symbol = Object.keys(trans)[0]
            output.symbol = symbol
            output.transfer = trans
            if(verify){
                return CMD_NFT_Transfer._verifyTransfer(output)
            }
        } catch (e) {
            output.err = "Invalid format"
        }
        return output
    }
    static _verifyTransfer(output,nidObj=null,objMap=null){
        const symbol = output.symbol
        const nft = bsvdb.getNFT(symbol)
        if (!nft) { output.err = `NFT ${symbol} does't exist`; return output }
        if(nidObj==null) nidObj = bsvdb.loadDomain(output.domain)
        const mynft = nidObj.nfts[symbol]
        if (!mynft) { output.err = `You don't own ${symbol}`; return output }
        let transInfo = output.transfer[symbol], amounts = {}
        const isCreator = (output.domain === nft.attributes.creator_id)
        if(!isCreator&&nft.allowTrade==false){
            output.err = `Trading of ${symbol} is not allowed`; return output
        }
        for (const item of transInfo) {
            let group = item.group ? item.group : "0"
            if (!isCreator && !mynft[group]) {
                output.err = `${symbol}: No such group ${group}`
                return output
            }
            if (!amounts[group]) amounts[group] = 0
            amounts[group] += item.v
            //check if item.to is valid nbdomain
            let desObj = null
            if(objMap)desObj = objMap[item.to]
            if(desObj==null)
                desObj = bsvdb.loadDomain(item.to)
            if(!desObj){
                output.err = `${item.to} is not registered`
                return output
            }
        }
        for (let group in amounts) {
            let existingAmount = isCreator ? (mynft[group] ? mynft['0'].amount + mynft[group].amount : mynft['0'].amount) :
                (mynft[group] ? mynft[group].amount : 0)
            if (existingAmount < amounts[group]) {
                output.err = `${symbol}: Not enough ${symbol} in group ${group}`
                return output
            }
        }
        return output
    }
    static _addNFT(thisNFT, item, gid) {
        if (!thisNFT[gid]) thisNFT[gid] = { amount: 0 }
        thisNFT[gid].amount += item.v
        if(item.gdata)
            thisNFT[gid].gdata = item.gdata
    }
    static _deductNFT(nidObj, symbol, amount, gid) {
        const nft = bsvdb.getNFT(symbol)
        const isCreator = (nidObj.domain === nft.attributes.creator_id)
        if (!isCreator) {
            if (!nidObj.nfts[symbol][gid] || nidObj.nfts[symbol][gid].amount < amount) return false
            nidObj.nfts[symbol][gid].amount -= amount
            if(nidObj.nfts[symbol][gid].amount == 0)
                delete nidObj.nfts[symbol][gid]
            return true
        }
        let fromDef = 0 //how much shall be dedcuted from default group
        if(gid==='0')fromDef = amount
        else
            nidObj.nfts[symbol][gid] ? fromDef = amount - nidObj.nfts[symbol][gid].amount : fromDef = amount
        if (fromDef < 0) { //enough amount from gid
            nidObj.nfts[symbol][gid].amount -= amount
            nidObj.nfts[symbol][gid].amount == 0 ? delete nidObj.nfts[symbol][gid]: true
            return true
        }
        if (fromDef > nidObj.nfts[symbol]['0'].amount) return false
        if(gid!=='0'&&nidObj.nfts[symbol][gid]) //not default group, set to zero
            nidObj.nfts[symbol][gid].amount = 0
        nidObj.nfts[symbol]['0'].amount -= fromDef
        
        return true

    }
    static fillObj(nidObj, rtx, objMap) {
        if (nidObj.owner_key == null || nidObj.owner_key != rtx.publicKey) return null
        try {
            const symbol = rtx.output.symbol
            const transfer = rtx.output.transfer
            if(CMD_NFT_Transfer._verifyTransfer(rtx.output,nidObj,objMap).err) return null
            for (let item of transfer[symbol]) {
                let desObj = objMap[item.to]
                if (!desObj) {
                    desObj = bsvdb.loadDomain(item.to)
                    if (desObj)
                        objMap[item.to] = desObj;
                }
                if (!desObj) continue
                if (!desObj.nfts) desObj.nfts = {}
                if (!desObj.nfts[symbol]) desObj.nfts[symbol] = {}
                const group = item.group?item.group:'0'
                if (CMD_NFT_Transfer._deductNFT(nidObj, symbol, item.v, group) == false) {
                    console.error(`run ${rtx.command} for ${nidObj.domain} error: deduct failed`)
                    return null
                }
                CMD_NFT_Transfer._addNFT(desObj.nfts[symbol], item, group)
                desObj.dirty = true

            }
            CMD_NFT_Create._addLog(nidObj, rtx)
            return nidObj

        } catch (e) {
            console.error(e)
            rtx.output.err = e.message
            return null
        }
        return null
    }
}
class CMD_NFT_REFILL {
    static parseTX(rtx, verify) {
        let output = CMD_BASE.parseTX(rtx);
        const para = JSON.parse(rtx.out[0].s5)
        output.para = para
        if(verify) output = CMD_NFT_REFILL._verify(output)
        return output
    }
    static _verify(output){
        const symbol =  Object.keys(output.para)[0]
        const nft = bsvdb.getNFT(symbol)
        if(!nft)output.err = `${symbol} does not exist`
        if(!nft.attributes.allowRefill) output.err = `${symbol} does not allow refill`
        if(output.domain !== nft.attributes.creator_id) output.err = `${output.domain} is not the creator of ${symbol}, can not refill`
        return output
    }
    static fillObj(nidObj,rtx){
        if (nidObj.owner_key == null || nidObj.owner_key != rtx.publicKey) return null
        if(CMD_NFT_REFILL._verify(rtx.output).err) return null
        const amount = rtx.output.para.amount
        const symbol =  Object.keys(rtx.output.para)[0]
        if(!nidObj.nfts[symbol])nidObj.nfts[symbol]={}
        nidObj.nfts[symbol]['0'].amount+=amount
        return nidObj
    }
}
class CMD_NFT_SELL {
    static parseTX(rtx, verify) {
        let output = CMD_BASE.parseTX(rtx);

        return output
    }
    static fillObj(nidObj,rtx){
        if (nidObj.owner_key == null || nidObj.owner_key != rtx.publicKey) return null
       
        return null
    }
}
class CMD_NFT_BUY {
    static parseTX(rtx, verify) {
        let output = CMD_BASE.parseTX(rtx);

        return output
    }
    static fillObj(nidObj,rtx){
        if (nidObj.owner_key == null || nidObj.owner_key != rtx.publicKey) return null
       
        return null
    }
}

module.exports = { Parser_NFT }