import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {eligible,due,choiceFor}=require('../public/nearby-event-alerts-v1.js');
const today=new Date(2026,9,8,12);
const date=days=>new Date(2026,9,8+days,12);
test('discovery includes today and day 30, excludes past, day 31 and invalid dates',()=>{
  assert(eligible(date(0),today));assert(eligible(date(30),today));
  assert(!eligible(date(-1),today));assert(!eligible(date(31),today));assert(!eligible(new Date(NaN),today));
});
test('dismissal and interest suppress subsequent prompts',()=>{
  assert(!due(choiceFor('dismissed'),date(3),today));
  assert(!due(choiceFor('interested'),date(3),today));
});
test('saved reminder becomes due at seven days and can be acknowledged once',()=>{
  const choice=choiceFor('remind',false);
  assert(!due(choice,date(8),today));assert(due(choice,date(7),today));assert(due(choice,date(0),today));
  assert(!due(choiceFor('remind',true),date(7),today));
});
test('calendar-day reminder works across daylight-saving time and year changes',()=>{
  assert(due(choiceFor('remind'),new Date(2026,10,1,12),new Date(2026,9,25,12)));
  assert(due(choiceFor('remind'),new Date(2027,0,4,12),new Date(2026,11,28,12)));
});
