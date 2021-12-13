const {Util} = require('./util')
const { CONFIG } = require('./config')
const { CMD,DEF } = require('./def')
const Parser = require('./parser')
var axios = require("axios");





class DomainTool {
    /**
   * Fetch NidOject from remote endpoint.
   * @param {!NidObject} domain 
   */
    static async fetchDomainAvailibility(domain) {
        try {
            let url = `${CONFIG.nidcheck_endpoint}${domain}`;
            console.log(`Sending request to URL ${url}`);
            let res = await axios.get(url, { timeout: 10000 });
            return res.data;
        } catch (error) {
            console.log(error);
            return { code: -1000, message: error };
        }
    }

    /**
     * Reset NidObject to initial state.
     * @param {NIDObject!} nidObj 
     * @param {!string} newOwner 
     * @param {!Number} newStatus 
     */
    static resetNid(nidObj, newOwner, newOnwerTxid, newStatus, clearData = true) {
        nidObj.owner_key = newOwner;
        if (newOwner != null) {
            nidObj.owner = Util.getAddressFromPublicKey(nidObj.owner_key);
            nidObj.txid = newOnwerTxid;
        } else {
            nidObj.owner = null;
            nidObj.txid = 0;
        }
        nidObj.status = newStatus;
        if (clearData) {
            nidObj.admins = [];
            nidObj.keys = {};
            nidObj.users = {};
            nidObj.update_tx = {};
            nidObj.admin_update_tx = 0;
        }
        nidObj.tf_update_tx = 0
        nidObj.sell_info = null;
        return nidObj;
    }
    /**
       * Check if a pair of trasfer/accept RTX are valid.
       * @param {ReadableTranscation} acceptRx The accept RTX.
       * @return {Boolean} True if the transfer/accept RTX pair are valid.
       */
    static validNIDTransfer_(nidObj, acceptRx) {
        return true;
    }
    /**
     * Update NidObject according to transaction.
     * @param {!NIDObject} nidObj 
     * @param {!ReadableTranscation} rtx 
     */
    static updateNidObjFromRX(nidObj, rtx) {
        if (rtx != null) {
            if (rtx.command == CMD.ADMIN) {
                nidObj.admins = rtx.output.value;
                nidObj.admin_update_tx = rtx.txid;
            }
            if (rtx.command == CMD.KEY) {
                // Change deep merge to shallow merge.
                for (const key in rtx.output.value) {
                    let lowerKey = key.toLowerCase();
                    nidObj.keys[lowerKey] = rtx.output.value[key];
                    nidObj.update_tx[lowerKey + '.'] = rtx.txid;
                    if (rtx.output.tags) {
                        nidObj.tag_map[lowerKey + '.'] = rtx.output.tags;
                    }
                }

            }
            if (rtx.command == CMD.USER) {
                // Change deep merge to shallow merge.
                for (const key in rtx.output.value) {
                    let lowerKey = key.toLowerCase();
                    nidObj.users[lowerKey] = rtx.output.value[key];
                    nidObj.update_tx[lowerKey + '@'] = rtx.txid;
                    if (rtx.output.tags) {
                        nidObj.tag_map[lowerKey + '@'] = rtx.output.tags;
                    }
                }
            }
            if (rtx.command == CMD.SELL) {
                nidObj.sell_info = {
                    price: rtx.output.price,
                    buyer: rtx.output.buyer,
                    expire: rtx.output.expire,
                    note: rtx.output.note,
                    clear_data: rtx.output.clear_data,
                    seller: Util.getAddressFromPublicKey(rtx.publicKey).toString(),
                    sell_txid: rtx.txid
                };
                nidObj.tf_update_tx = rtx.txid;
            }
            if (rtx.command == CMD.TRANSFER) {
                nidObj.owner_key = rtx.output.owner_key;
                nidObj.owner = Util.getAddressFromPublicKey(rtx.output.owner_key).toString();
            }
        }
        return nidObj;
    }

    /**
     * Delete a transaction from rtxArry by hash.
     * @param {!Array} rtxArray 
     * @param {!string} hash 
     */
    static removeRtxByHash(rtxArray, hash) {
        for (var i = 0; i < rtxArray.length; i++) {
            if (rtxArray[i].txid === hash) {
                rtxArray.splice(i, 1);
            }
        }
        return rtxArray;
    }

    /**
     * Find first vaild register transactions.
     * @param {Array<Object>} rxArray Array of readable transaction objects. 
     * @return {ReadableTranscation} The first RTX for register command.
     */
    static findFirstRegister_(rxArray) {
        for (let i = 0; i < rxArray.length; i++) {
            let rx = rxArray[i];
            if (rx.command !== CMD.REGISTER) {
                continue;
            }
            return rx;
        }
        return null;
    }
}

// ------------------------------------------------------------------------------------------------

module.exports = {
    DomainTool
}