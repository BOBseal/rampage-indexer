//const express = require('express');
import express from 'express';
import { ethers } from 'ethers';
//const ethers = require('ethers');
import dotenv from "dotenv"
//const dotenv = require('dotenv');
//const fs = require('fs').promises;
import fs from "fs/promises"
import cors from "cors"
//const cors = require('cors');
import axios from 'axios';
import fetch from 'node-fetch';
//const path = require('path')
//const axios =  require("axios");

import EvAbi from './Utils/EventCore.json' assert { type: 'json' }
import SkibAbi from './Utils/SKIBBIDIESOFBITCOIN.json' assert { type: 'json' }
import wrpAbi from './Utils/WrappedRP.json' assert { type: 'json' }
import stakeAbi from './Utils/StakingRP.json' assert { type: 'json' }


dotenv.config();

const app = express();
app.use(cors())

const percentPerDist = 3;
const port = process.env.PORT || 5000;
const projectKey=process.env.PROJECT_KEY ||"";
const basePath = './db/';

const eventContract = '0xCA9c5943Dd7d0fE1E6A0Cf12F2eA65d310A3b2AA';
const skibbidiCa = "";
const wrpContract = "";
const stakeContract = "";

const explorerBob = 'https://explorer.gobob.xyz/api/v2';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const coreAbi = EvAbi.abi;
const wallet =  new ethers.Wallet(process.env.BURNER_KEY,provider);

// core instance
const core = new ethers.Contract(eventContract,coreAbi,wallet);

// wRP instance 

const wrp = new ethers.Contract(wrpContract,wrpAbi.abi,wallet);
// StakeCore instance

const stake = new ethers.Contract(stakeContract,stakeAbi.abi,wallet);

// skibidi instance 

const skib = new ethers.Contract(skibbidiCa,SkibAbi.abi,wallet);


async function readFile(index) {
  try {
      const _path = `${basePath}${index}.json`
      const data = await fs.readFile(_path, 'utf8');
      const pData = JSON.parse(data);
      return pData;
  } catch (error) {
      console.error('Error reading JSON file:', error);
      throw error;
  }
}

async function writeJsonFile(index, data) {
  try {
      const _path = `${basePath}${index}.json`
      const jsonData = JSON.stringify(data, null, 2); 
      await fs.writeFile(_path, jsonData, 'utf8');
      return true;
  } catch (error) {
      console.error('Error writing JSON file:', error);
      throw error;
  }
}


const getInternalTxs = async() => {
  try {
      let dbfile = await readFile("nextParams");
      //let usr = await readFile("users");

      let nextParams = dbfile.param;
      //let buff = dbfile.otherData;
      let url = ''
      //const totalUsers = await core.getTotalUsers();
      //const currentUsers = usr.adresses.length;
      if(nextParams.block_number>0 && nextParams != null ) {
          url = `${explorerBob}/addresses/${eventContract}/internal-transactions?filter=to%20%7C%20from&block_number=${nextParams.block_number}&index=${nextParams.index}&items_count=${nextParams.items_count}&transaction_index=${nextParams.transaction_index}`
      } 
      if(nextParams.block_number == 0){
          url = `${explorerBob}/addresses/${eventContract}/internal-transactions?filter=to%20%7C%20from`
      }
      
      const {data} = await axios.get(url)
      const accountCreationTxs = data["items"].filter(item => item.type == "call" && item?.success == true);
      //console.log(data)
      const paramss = data.next_page_params != null ?data.next_page_params:{block_number:0} 
      let newDbfile = {param:paramss}
      //await writeJsonFile(`lastCall`,dbfile);
      await writeJsonFile("nextParams",newDbfile);
      return accountCreationTxs;
  } catch(err) {
      console.log(err)
      return err
  }

}

async function checkingAccountCreationTxs(tx) {
  const url = `${explorerBob}/transactions/${tx?.transaction_hash}`
  const res = await fetch(url)
  const data = await res.json();
  if(data?.method == "createAccount" && data?.status == "ok") {
    //await delay(50);
    return data?.from?.hash;
  } else {
    console.log(`${tx.transaction_hash} is not account creation tx`)
    //await delay(50);
    return false;
  }
}

async function indexUsers(){
  console.log("fetching")
  try {
    let lastAddr;
    let users = await readFile("registrants");
    let usrArr = users.addresses;
    let obj = {addresses:users.addresses};
    const tx =await getInternalTxs();
    for(const dx of tx){
      const txFrom = await checkingAccountCreationTxs(dx);
      if(txFrom != false && !usrArr.includes(txFrom)){
        console.log(`${txFrom} is valid & saved`)
        usrArr.push(txFrom);
        obj = {addresses:usrArr};
      }
      lastAddr = txFrom;
    }
    await writeJsonFile("registrants",obj);
    console.log("This batch processed")
  } catch (error) {
    console.log(error)
  }
}



////////// SPICE DISTRIBUTIONS ///////////////////

async function _increaseDistCounter(){
  try {
      const data = await readFile("totalDist");
      const dist =  data.counter 
      const plus = dist + 1;
      await writeJsonFile("totalDist",{counter:plus})
      return true;   
  } catch (error) {
    console.log(error)
    return null
  }
}



async function distributeRewards () {
  try {
    const db = await readFile("registrants");
    const rewardReceivers = db.addresses;
    const crr = await readFile("totalDist");
    const distRound = crr.counter;
    const tfArr = await getTransfersArray(rewardReceivers);
    console.log("total rewards receiver in this batch is", tfArr.length)
    const data = { transfers: tfArr }
    const headers = { 'x-api-key': process.env.PROJECT_KEY, 'Content-Type': 'application/json' }
             //    spice distribution call for 
     const res = await fetch(`https://app.gobob.xyz/api/distribute-points`, {
                  method: "POST",
                  body: JSON.stringify(data),  
                  headers 
                  })
                  //console.log(`rewards being distributes, pls wait to complete`)
             if(res) {
                 _increaseDistCounter();
                 await writeJsonFile(`dist/${distRound}`,data);
                 console.log(`Round ${distRound} Distributed Successfully`)
             } else {
                await writeJsonFile(`dist/fails/${distRound}_fail`,data);
             }

      } catch(err) {
          console.log(err.message)
      }

}


async function fetchPartners() {
  try {
    const response = await axios.get('https://app.gobob.xyz/api/partners', {
      headers: {
        'Accept': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching partners:', error);
    throw error; // Rethrow the error after logging it
  }
}

async function getTransfersArray(UserArr){
  try {
    //const arrs = await readFile("registrants")
    const arr = UserArr
    const bobpartners= await fetchPartners();
    const filteredResult = bobpartners?.partners.filter(partner=> partner.name ==="BOTS OF BITCOIN ");
    const currentSpices = filteredResult[0]?.current_points;
    //const currentSpices = 100000
    const totalRP = await core.getTotalPoints();
    const SpicePerRp = Number(currentSpices)/Number(totalRP);
    //console.log(SpicePerRp);
    //console.log(Number(totalRP))
    let transfersArray =[];
    if(arr.length >0 ){
      for(const address of arr){
        const userRp = await core.getUser(address);
        const userP = Number(userRp[1]);
        const userTotalEligible = Number(userP) * Number(SpicePerRp);
        const currentRoundEligible = (percentPerDist/ 100) * userTotalEligible;
        const Obj = {toAddress:address,points:Number(currentRoundEligible)};
        transfersArray.push(Obj)
        console.log(`Pushing ${Obj.toAddress} ${Obj.points}`)
      }
    }
    console.log(`Executing Distribution`)
    return transfersArray;
  } catch (error) {
    console.log(error)
  }
}

indexUsers();
setInterval(()=>indexUsers(), 30*1000);

setInterval(()=>distributeRewards(), 24 * 60 *60 *1000);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
