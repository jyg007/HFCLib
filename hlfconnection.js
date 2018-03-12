let hfc = require('fabric-client');

let utils = require('fabric-client/lib/utils.js');
let logger = utils.getLogger('HFClib');


let path = require('path');

let fs = require('fs-extra');

function sleep(ms){
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}

function readAllFiles(dir) {
    var files = fs.readdirSync(dir);
    var certs = [];
    files.forEach((file_name) => {
        let file_path = path.join(dir,file_name);
        logger.debug(' looking at file ::'+file_path);
        let data = fs.readFileSync(file_path);
        certs.push(data);
    });
    return certs;
}



class HLFConnection {
    constructor(cha) {
            this.client= hfc.loadFromConfig("network.yaml");
            this.channel = this.client.getChannel(cha);
            this.eventHubs = this.client.getEventHubsForOrg(this.client.getMspid());
    }

    async login(name,pass) {
        try {
            await this.client.initCredentialStores();
        }
        catch (err) {
            logger.error('Unable to initialize state store: ' + err.stack ? err.stack : err);
        }
        tmpuser = await this.client.getUserContext(name,true);
        
        if (!tmpsur) {
            tmpuser = await this.client.setUserContext({username:name, password: pass});
        } else {
            await this.client.setUserContext(tmpuser,true);
        }

        try {
            await this.channel.initialize();
        }
        catch (err) {
            logger.error('Unable to get channel ' + cha + ' configuration: ' + err.stack ? err.stack : err);
        }
       this._connectToEventHubs();
    }


    async login_fromfile(name,file) {
        try {
            await this.client.initCredentialStores();
        }
        catch (err) {
            logger.error('Unable to initialize state store: ' + err.stack ? err.stack : err);
        }
    
    
        let keyPath = path.join(file, "keystore");
        let keyPEM = Buffer.from(readAllFiles(keyPath)[0]).toString();
        let certPath = path.join(file, "signcerts");
        let certPEM = readAllFiles(certPath)[0];

        const tmpuser = await this.client.createUser({
            username: name,
            mspid: this.client.getMspid(),
            cryptoContent: {
                privateKeyPEM: keyPEM.toString(),
                signedCertPEM: certPEM.toString()
            }
        })
        
        this.client.setUserContext(tmpuser);
        
        try {

            await this.channel.initialize();
        }
        catch (err) {
            logger.error('Unable to get channel ' + cha + ' configuration: ' + err.stack ? err.stack : err);
        }

       this. _connectToEventHubs();
    }

    
    async  invoke(request) {
        try {
            let all_good;
            let incident_n=0;
            let one_good;
            let proposalResponses;
            let proposal;

    
            let validResponses = [];
    
            do {
                if (incident_n != 0 ) {
                    sleep(5000);
                    logger.info("Nouvel essai");
                    //console.log(channel.getPeers());
                    //console.log(request.targets);
                }
                incident_n++;
    
                const results = await this.channel.sendTransactionProposal(request,3000);
    
                proposalResponses = results[0];
                proposal = results[1];
     
            
               all_good = true;
            
                for (let i in proposalResponses) {
                    let one_good = false;  
                    let proposal_Response = proposalResponses[i];
    
                    if (proposal_Response instanceof Error ) {
                        let listpeer=this.channel.getPeers();
                        try {
                            logger.error("Probleme sur " + listpeer[i]._name +":"+proposal_Response);
                            //console.log(typeof proposal_Response);
                            //console.log(proposal_Response.name);
                            //console.log(typeof proposal_Response.message);
                            // Gestion erreur de connection sur un noeud par gestion du timeout
                            if ((proposal_Response.message == "REQUEST_TIMEOUT" ) && (incident_n==2))   { 
                                logger.error(proposal_Response.name + " " + proposal_Response.message + " sur " + listpeer[i]._name + ". Supression de la liste de requête");
                                //request.targets.splice(i,1);
                            };
                         
                        } catch (err) {
                            logger.error('erreur dans le traitement des exceptions: ' + err.stack ? err.stack : err);
                            
                        }
                    } else {
                        if (proposal_Response.response && proposal_Response.response.status === 200) {
                            one_good = this.channel.verifyProposalResponse(proposal_Response);
                            if(!one_good) {
                                logger.error("Transaction Proposal signature or endorsment invalid");
                            } else {
                                validResponses.push(proposal_Response);
                            }
                        } 
                    }
                    all_good = all_good & one_good;
                }
            } while ((incident_n <=3) && (!all_good));
    
    
            if (all_good) {
                all_good = this.channel.compareProposalResponseResults(validResponses);
    
                if(all_good){
                        logger.debug('All proposals have a matching read/writes sets');
                }
                else {
                        logger.error('All proposals do not have matching read/write sets');
                        return [ 'All proposals do not have matching read/write sets for '+ deployId , 3 ];
                }
            }
    
            if (all_good) {
                let answer = validResponses[0].response.payload.toString(); // store results returned by shim.success() in chaincode
                //logger.info(util.format('Successfully sent Proposal and received ProposalResponse: Status - %s, message - "%s", metadata - "%s", endorsement signature: %s', proposalResponses[0].response.status, proposalResponses[0].response.message, proposalResponses[0].response.payload, proposalResponses[0].endorsement.signature));
    
                let request_orderer = {
                    proposalResponses: validResponses,
                    proposal: proposal,
                };
    
                // set the transaction listener and set a timeout of 30sec
                // if the transaction did not get committed within the timeout period,
                // fail the test
                let deployId = request.txId.getTransactionID();
    
                let eventPromises = [];
                let timeoutHandles = [];

    
                this.eventHubs.forEach((eh) => {
                    try {
                       //eh.connect();
                    }
                    catch(err) {
                        logger.error("error de connection sur le event server");
                    }
                    let handle;
                    let txPromise = new Promise((resolve, reject) => {
                        handle = setTimeout(reject, 30000);
                
                        eh.registerTxEvent(deployId.toString(), 
                            (tx, code) => {
                                clearTimeout(handle);
                                eh.unregisterTxEvent(deployId);
                                //eh.disconnect();
    
                                if (code !== 'VALID') {
                                    logger.error('The transaction was invalid, code = ' + code);
                                    reject();
                                } else {
                                    logger.info('The transaction has been committed on peer ' + eh.getPeerAddr());
                                    resolve();
                                }
                            },
                            (err) => {
                                clearTimeout(handle);
                                logger.error(err);
                                logger.error('Successfully received notification of the event call back being cancelled for '+ deployId);
                                resolve();
                            }
                        );
                    });
                    eventPromises.push(txPromise);
                    timeoutHandles.push(handle);
                });
    
                try {

                    const response2 = await this.channel.sendTransaction(request_orderer);
  
                    if (response2.status === 'SUCCESS') {
                        //logger.info('Successfully sent transaction to the orderer.');
                        
    
                        // Wait for results from events server
                        try {
                            let results3 = await Promise.all(eventPromises);
                            //logger.info('event promise all complete and testing complete');
                            return [ answer , 0 ] ;
                        } catch(err) {
                            logger.error('Error received from some event servers ' + err);
                            return [ 'Failed to send transaction and get notifications within the timeout period.' + err,4 ] 
                        }
                    } else {
                        timeoutHandles.forEach((handle) => {
                            clearTimeout(handle);
                        });
                        this.eventHubs.forEach((eh) => {
                            eh.unregisterTxEvent(deployId);
                           // eh.disconnect();
                        });
                        logger.error('Failed to order the transaction. Error code: ' + response2.status);
                        return [ 'Failed to order the transaction. Error code: ' + response2.status ,5 ];
                    }    
                } 
                catch(err) {
                    timeoutHandles.forEach((handle) => {
                        clearTimeout(handle);
                    });
                    this.eventHubs.forEach((eh) => {
                        eh.unregisterTxEvent(deployId);
                        //eh.disconnect();
                    });
                    logger.error('Failed to send transaction due to error: ' + err.stack ? err.stack : err);
                    return [ "Failed to send transaction",6 ];
                }
            } else {
                logger.error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
                return [ "Failed to send proposal",7 ];
            }
        }
        catch(err) {
                logger.error('Failed to send proposal due to error: ' + err.stack ? err.stack : err);
                return [ "Failed to send proposal", 8 ];
        }                
    }


    getTxId() {
        return this.client.newTransactionID(false);
    }

    getAdminTxId() {
        return this.client.newTransactionID(true);
    }


    async query(request) {
        let payloads;
        payloads = await this.channel.queryByChaincode(request);
        return payloads;
    }

        /**
     * process the event hub defs to create event hubs and connect
     * to them
     */
    _connectToEventHubs() {
        this.eventHubs.forEach((eventHub) => {
            eventHub.connect();
        });

        if (this.eventHubs.length > 0) {
            this.exitListener = () => {
                this.eventHubs.forEach((eventHub, index) => {
                    if (eventHub.isconnected()) {
                        eventHub.disconnect();
                    }
                    // unregister any eventhub chaincode event registrations
                    if (this.ccEvents[index]) {
                        this.eventHubs[index].unregisterChaincodeEvent(this.ccEvents[index]);
                    }
                });
            };

            process.on('exit', this.exitListener);
        }

    }

}

module.exports = HLFConnection;