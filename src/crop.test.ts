import {describe,it,expect} from "vitest";
import {dragCrop,fullCrop} from "./crop";
describe("visual image crop",()=>{
 it("resizes corners while anchoring the opposite corner",()=>{expect(dragCrop(fullCrop,"nw",0.2,0.3)).toEqual({x:0.2,y:0.3,width:0.8,height:0.7});expect(dragCrop(fullCrop,"se",-0.2,-0.3)).toEqual({x:0,y:0,width:0.8,height:0.7});});
 it("moves within source bounds without changing crop size",()=>{expect(dragCrop({x:0.1,y:0.2,width:0.4,height:0.3},"move",2,-2)).toEqual({x:0.6,y:0,width:0.4,height:0.3});});
 it("prevents flipped or empty crops",()=>{const result=dragCrop(fullCrop,"nw",2,2);expect(result.width).toBeCloseTo(0.01);expect(result.height).toBeCloseTo(0.01);expect(dragCrop(fullCrop,"se",2,2)).toEqual(fullCrop);});
 it("ignores invalid pointer deltas",()=>{expect(dragCrop(fullCrop,"move",NaN,0)).toEqual(fullCrop);});
});
