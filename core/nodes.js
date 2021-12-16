const config = require('./config')
const axios = require('axios')
let node = null
class Nodes{
    async selectNode(nodes,count=1){
        return new Promise(resolve=>{
            let i=1,selected_nodes=[]
            for(const node of nodes){
                axios.get(node+"/api/p2p/ping").then(res=>{
                    if(res.data&&res.data.msg=="pong"){
                        selected_nodes.push(node)
                        ++i
                    }
                }).catch(e=>{
                    console.log(e)
                })
                if(i>count)break;
            }
            resolve(selected_nodes.length==0?null:selected_nodes)
        })
    }
    async init(){
        this.endpoint = config.CONFIG.node_info.domain
        setTimeout(this.refreshPeers.bind(this),60000)
        return node
    }
    async refreshPeers(){
        const port = config.CONFIG.node_port
        const res = await axios.get("http://localhost:"+port+"/api/queryKeys?tags=nbnode")
        if(res.data){
            this.peers = await this.selectNode(res.data.data,50)
            console.log(`found ${this.peers.length} peers`)
        }
        setTimeout(this.refreshPeers.bind(this),5000)
    }
    async notifyPeers({cmd,data}){
        for (const peer of this.peers) {
            const url = peer+"/p2p/"+cmd+"?data="+data+"&&from="+this.endpoint
            axios.get(url)
        }
    }
    static Instance(){
        if(node==null){
            node = new Nodes
        }
        return node
    }
}
module.exports = Nodes.Instance()