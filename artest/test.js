
const process = require('process')
const ArCrawler = require('./arcrawler')

const START = 828316
const nodeURL = "https://arweave.net"
const filter = {
    name: "protocol", value: "nbtest2"
}
//axios.defaults.timeout = 5000;

function fromB64Url(input) {
    const paddingLength = input.length % 4 === 0 ? 0 : 4 - (input.length % 4);

    const base64 = input
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .concat('='.repeat(paddingLength));

    return Buffer.from(base64, 'base64');
}
function isValidUTF8(buffer) {
    return Buffer.compare(Buffer.from(buffer.toString(), 'utf8'), buffer) === 0;
};
function utf8DecodeTag(tag) {
    let name;
    let value;
    try {
        const nameBuffer = fromB64Url(tag.name);
        if (isValidUTF8(nameBuffer)) {
            name = nameBuffer.toString('utf8');
        }
        const valueBuffer = fromB64Url(tag.value);
        if (isValidUTF8(valueBuffer)) {
            value = valueBuffer.toString('utf8');
        }
    } catch (error) { }
    return {
        name,
        value,
    };
};

function validateTransaction(tx) {
    //console.log("validating tx", tx.id)
    //console.log(tx.tags)
    if (tx.id == "i5kcZG-O3UxtGwGoft_nzN-4d6G1YnhSzksPCZ8Pupg") {
        console.log("found")
    }
    for (tag of tx.tags) {
        const _tag = utf8DecodeTag(tag)
        if ((_tag.name == filter.name) && (_tag.value == filter.value)) {
            console.log("--------------found valid tag------------------")

            return true
        }
    }
    return false
}



(async () => {
    process.on('unhandledRejection', (reason, promise) => {
        console.log(reason)
    })
    process.on('uncaughtException', (reason) => {
        console.log(reason)
    })
    process.on('SIGTERM', signal => {
        console.log(`Process ${process.pid} received a SIGTERM signal`)
        process.exit(0)
    })

    process.on('SIGINT', signal => {
        console.log(`Process ${process.pid} has been interrupted`)
        process.exit(0)
    })
    const crawler = new ArCrawler
    await crawler.init({debug:true})
    await crawler.start(START,0,(type,obj)=>{
        if(type=='block'){
            console.log("got new block",obj)
        }
        if(type=="tx"){
            console.log(obj)
            validateTransaction(obj)
        }
    })

})()