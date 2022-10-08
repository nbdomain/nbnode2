const CONSTS = require('./const')
const { Util } = require('./util')
const { Nodes } = require('./nodes')
var axios = require("axios");

class DomainTool {
    /**
   * Fetch NidOject from remote endpoint.
   * @param {!NidObject} domain 
   */
    static async fetchDomainPrice(domain, db, newTx = false) {
        try {
            await Util.initNBLib()
            const key = domain + ".prices"
            const obj = await db.loadDomain("priceinfo.a")
            if (obj && obj.keys[key]) {
                return { code: 0, price: obj.keys[key].value.price }
            }
            domain = encodeURIComponent(domain)
            const otherNode = Nodes.get({})
            if (otherNode) {
                try {
                    const url = otherNode + "/api/?nid=" + key + ".priceinfo.a"
                    console.log("getting price from:", url)
                    let res = await axios.get(url)
                    if (res.data && res.data.code == 0) return { code: 0, price: res.data.obj.value.price }
                } catch (e) {
                    console.error("fetchDomainPrice:", e.message)
                }
            }
            let url = `${CONSTS.nidcheck_endpoint}${domain}?prereg=${newTx}`;
            console.log(`Sending request to URL ${url}`);
            let res = await axios.get(url, { timeout: 10000 });
            return res.data;
        } catch (error) {
            console.log(error);
            return { code: -1000, message: error };
        }
    }

}

// ------------------------------------------------------------------------------------------------

module.exports = {
    DomainTool
}