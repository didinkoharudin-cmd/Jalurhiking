(function(global){
  'use strict';
  const HEADER_SIZE=127;
  const Compression={Unknown:0,None:1,Gzip:2,Brotli:3,Zstd:4};
  const TileType={Unknown:0,Mvt:1,Png:2,Jpeg:3,Webp:4,Avif:5,Mlt:6};
  const MIME={2:'image/png',3:'image/jpeg',4:'image/webp',5:'image/avif'};

  function u64(view,offset){
    const v=view.getBigUint64(offset,true);
    if(v>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('PMTiles terlalu besar untuk pembaca browser ini.');
    return Number(v);
  }
  function parseHeader(buffer){
    if(buffer.byteLength<HEADER_SIZE)throw new Error('File PMTiles terlalu kecil.');
    const bytes=new Uint8Array(buffer,0,7);
    const magic=String.fromCharCode(...bytes);
    if(magic!=='PMTiles')throw new Error('Magic number PMTiles tidak ditemukan.');
    const v=new DataView(buffer,0,HEADER_SIZE);
    const specVersion=v.getUint8(7);
    if(specVersion!==3)throw new Error(`Versi PMTiles ${specVersion} belum didukung. Gunakan PMTiles v3.`);
    return {
      specVersion,
      rootDirectoryOffset:u64(v,8),rootDirectoryLength:u64(v,16),
      jsonMetadataOffset:u64(v,24),jsonMetadataLength:u64(v,32),
      leafDirectoryOffset:u64(v,40),leafDirectoryLength:u64(v,48),
      tileDataOffset:u64(v,56),tileDataLength:u64(v,64),
      numAddressedTiles:u64(v,72),numTileEntries:u64(v,80),numTileContents:u64(v,88),
      clustered:v.getUint8(96)===1,internalCompression:v.getUint8(97),tileCompression:v.getUint8(98),tileType:v.getUint8(99),
      minZoom:v.getUint8(100),maxZoom:v.getUint8(101),
      minLon:v.getInt32(102,true)/1e7,minLat:v.getInt32(106,true)/1e7,maxLon:v.getInt32(110,true)/1e7,maxLat:v.getInt32(114,true)/1e7,
      centerZoom:v.getUint8(118),centerLon:v.getInt32(119,true)/1e7,centerLat:v.getInt32(123,true)/1e7
    };
  }
  async function decompress(buffer,compression){
    if(compression===Compression.None||compression===Compression.Unknown)return buffer;
    if(compression===Compression.Gzip){
      if(typeof DecompressionStream==='undefined')throw new Error('Browser tidak mendukung dekompresi gzip untuk PMTiles.');
      const stream=new Response(buffer).body;
      if(!stream)throw new Error('Gagal membaca data terkompresi.');
      return await new Response(stream.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
    if(compression===Compression.Brotli)throw new Error('PMTiles dengan kompresi internal Brotli belum didukung V2.');
    if(compression===Compression.Zstd)throw new Error('PMTiles dengan kompresi internal Zstd belum didukung V2.');
    throw new Error('Metode kompresi PMTiles tidak dikenali.');
  }
  function readVarint(state){
    let result=0n,shift=0n;
    for(let i=0;i<10;i++){
      if(state.pos>=state.buf.length)throw new Error('Direktori PMTiles terpotong.');
      const b=BigInt(state.buf[state.pos++]);
      result|=(b&0x7fn)<<shift;
      if((b&0x80n)===0n){
        if(result>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Nilai varint PMTiles terlalu besar.');
        return Number(result);
      }
      shift+=7n;
    }
    throw new Error('Varint PMTiles lebih dari 10 byte.');
  }
  async function decodeDirectory(buffer,compression){
    const raw=await decompress(buffer,compression),state={buf:new Uint8Array(raw),pos:0};
    const n=readVarint(state);
    if(!n||n>5_000_000)throw new Error('Direktori PMTiles tidak valid.');
    const entries=Array.from({length:n},()=>({tileId:0,runLength:0,length:0,offset:0}));
    let lastId=0;
    for(let i=0;i<n;i++){lastId+=readVarint(state);entries[i].tileId=lastId;}
    for(let i=0;i<n;i++)entries[i].runLength=readVarint(state);
    for(let i=0;i<n;i++)entries[i].length=readVarint(state);
    for(let i=0;i<n;i++){
      const value=readVarint(state);
      if(value===0&&i>0)entries[i].offset=entries[i-1].offset+entries[i-1].length;
      else entries[i].offset=value-1;
    }
    return entries;
  }
  function findTile(entries,tileId){
    let m=0,n=entries.length-1;
    while(m<=n){const k=(m+n)>>1,cmp=tileId-entries[k].tileId;if(cmp>0)m=k+1;else if(cmp<0)n=k-1;else return entries[k];}
    if(n>=0){const e=entries[n];if(e.runLength===0)return e;if(tileId-e.tileId<e.runLength)return e;}
    return null;
  }
  function rotate(n,x,y,rx,ry){if(ry===0){if(rx!==0)return[n-1-y,n-1-x];return[y,x];}return[x,y];}
  function zxyToTileId(z,x,y){
    if(z>26)throw new Error('Zoom PMTiles > 26 tidak didukung.');
    const dim=2**z;if(x<0||y<0||x>=dim||y>=dim)throw new Error('Koordinat tile di luar batas zoom.');
    let acc=(dim*dim-1)/3,a=z-1,tx=x,ty=y;
    for(let s=2**a;s>0;s=Math.floor(s/2)){
      const rx=(tx&s)?s:0,ry=(ty&s)?s:0;
      acc+=((3*rx)^ry)*(2**a);
      [tx,ty]=rotate(s,tx,ty,rx,ry);a--;
    }
    return acc;
  }
  function tileMime(tileType){return MIME[tileType]||'';}
  function isRaster(tileType){return tileType>=TileType.Png&&tileType<=TileType.Avif;}
  function cleanText(v){return String(v??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();}

  class Reader{
    constructor(blob){this.blob=blob;this.header=null;this.root=null;this.metadata=null;this.dirCache=new Map();}
    async bytes(offset,length){return await this.blob.slice(offset,offset+length).arrayBuffer();}
    async getHeader(){if(this.header)return this.header;this.header=parseHeader(await this.bytes(0,HEADER_SIZE));return this.header;}
    async getMetadata(){
      if(this.metadata)return this.metadata;
      const h=await this.getHeader();
      if(!h.jsonMetadataLength)return this.metadata={};
      try{const raw=await decompress(await this.bytes(h.jsonMetadataOffset,h.jsonMetadataLength),h.internalCompression);this.metadata=JSON.parse(new TextDecoder().decode(raw));}
      catch{this.metadata={};}
      return this.metadata;
    }
    async directory(offset,length,h){
      const key=`${offset}:${length}`;if(this.dirCache.has(key))return this.dirCache.get(key);
      const p=decodeDirectory(await this.bytes(offset,length),h.internalCompression);this.dirCache.set(key,p);return p;
    }
    async getZxy(z,x,y){
      const h=await this.getHeader();
      if(z<h.minZoom||z>h.maxZoom)return undefined;
      const tileId=zxyToTileId(z,x,y);
      let off=h.rootDirectoryOffset,len=h.rootDirectoryLength;
      for(let depth=0;depth<=3;depth++){
        const dir=await this.directory(off,len,h),entry=findTile(dir,tileId);
        if(!entry)return undefined;
        if(entry.runLength>0){const data=await this.bytes(h.tileDataOffset+entry.offset,entry.length);return await decompress(data,h.tileCompression);}
        off=h.leafDirectoryOffset+entry.offset;len=entry.length;
      }
      throw new Error('Kedalaman direktori PMTiles melebihi batas.');
    }
    async summary(){
      const header=await this.getHeader(),metadata=await this.getMetadata();
      return {header,metadata,name:cleanText(metadata.name||metadata.title||''),attribution:cleanText(metadata.attribution||''),mime:tileMime(header.tileType),raster:isRaster(header.tileType)};
    }
  }

  global.PMTilesLite={Reader,Compression,TileType,tileMime,isRaster,parseHeader,zxyToTileId,decodeDirectory,findTile};
})(window);
