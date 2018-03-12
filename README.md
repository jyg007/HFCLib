# HFCLib

Robust and simple library that complements HFC Node SDK to easily send transaction to a Fabric ledger.  Some portion are inspired by hlcconnection() class from hyperledger composer.
The library is provised with no warranty and is not part of hyperledger project.

The user can login from CA, a store or from raw file (msp directory where your credentials are stored).

Enjoy.


To use it, copy the lib in your apps.

    let HLFconnection = require('./hlfconnection.js');
    let connection = new HLFconnection("mychannel");

    await connection.login_fromfile("admin","~girardjy/msp");

    let tx_id = connection.getTxId();

    let annulation_request =   {
        chaincodeId: 'sc',
        fcn: 'delete',
        args: [ "blabla" ],
        txId: tx_id
    };
    await connection.invoke(annulation_request);
