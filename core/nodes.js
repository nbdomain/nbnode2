const config = require('./config')
const axios = require('axios')
let node = null
class Nodes{
    async selectNode(nodes){
        return new Promise(resolve=>{
            for(const node of nodes){
                axios.get(node+"/api/p2p/ping").then(res=>{
                    if(res.data&&res.data.msg=="pong"){
                        resolve( node )
                        return;
                    }
                })
            }
            resolve(null)
        })
    }
    async init(){
        const node = await this.selectNode(config.CONFIG.seeds)
        console.log("selected node:",node)
    }
    static Instance(){
        if(node==null){
            node = new Nodes
        }
        return node
    }
}
module.exports = Nodes.Instance()