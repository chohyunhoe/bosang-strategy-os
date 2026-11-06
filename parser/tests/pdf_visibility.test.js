'use strict';
const assert = require('node:assert/strict');
(async()=>{
 const {visiblePdfItems,selectOcrPageNumbers}=await import('../../browser/product-v2/pdf-source.js');
 const content={items:[{str:'VISIBLE',transform:[10,0,0,10,10,10],width:20,height:10},{str:'MASKED',transform:[10,0,0,10,60,10],width:20,height:10}]};
 let pixel=255, rendered=0;
 global.document={createElement:()=>({width:0,height:0,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray([pixel,pixel,pixel,255])})})})};
 const annotation={subtype:'Square',hasAppearance:true,annotationFlags:4,rect:[50,0,90,30]};
 const page={getAnnotations:async()=>[annotation],getViewport:()=>({width:100,height:100,convertToViewportRectangle:box=>box}),render:options=>{assert.equal(options.annotationMode,1);rendered++;return{promise:Promise.resolve()};}};
 const pdfjs={AnnotationMode:{ENABLE:1}};
 const hidden=await visiblePdfItems(page,content,pdfjs);
 assert.deepEqual(hidden.items.map(row=>row.str),['VISIBLE']);assert.equal(hidden.hidden_text_items,1);assert.equal(hidden.requires_visual_ocr,false);
 pixel=0;
 const uncertain=await visiblePdfItems(page,content,pdfjs);
 assert.deepEqual(uncertain.items.map(row=>row.str),['VISIBLE']);assert.equal(uncertain.requires_visual_ocr,true);
 const textPages=[{page_no:1,text:'본문 '.repeat(300),requires_visual_ocr:true},{page_no:2,text:'본문 '.repeat(300)}];
 assert.deepEqual(selectOcrPageNumbers(textPages),[1]);
 const failure=await visiblePdfItems({...page,render:()=>{throw Error('render unavailable');}},content,pdfjs);
 assert.equal(failure.requires_visual_ocr,true);assert.deepEqual(failure.items.map(row=>row.str),['VISIBLE']);
 const uninspected=await visiblePdfItems({...page,getAnnotations:async()=>{throw Error('annotations unavailable');}},content,pdfjs);
 assert.equal(uninspected.items.length,0);assert.equal(uninspected.requires_visual_ocr,true);
 for(const flag of [1,2,32]){
  const invisible=await visiblePdfItems({...page,getAnnotations:async()=>[{...annotation,annotationFlags:flag}]},content,pdfjs);
  assert.equal(invisible.items.length,2);assert.equal(invisible.requires_visual_ocr,false);
 }
 const plain=await visiblePdfItems({...page,getAnnotations:async()=>[]},content,pdfjs);
 assert.equal(plain.items.length,2);assert.equal(rendered,2);
 console.log('pdf_visibility.test.js passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
