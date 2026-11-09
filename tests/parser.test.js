import test from 'node:test';
import assert from 'node:assert/strict';
import {extractBill,parseDate,chinaDay,dayDiff} from '../src/parser.js';
test('北京时间与跨年日期',()=>{assert.equal(chinaDay(new Date('2026-12-31T16:01:00Z')),'2027-01-01');assert.equal(parseDate('1月5日','2026-12-25'),'2027-01-05');assert.equal(parseDate('2026年2月30日'),null);assert.equal(parseDate('2026-11-09'),'2026-11-09');assert.equal(dayDiff('2026-11-09','2026-11-10'),-1)});
test('HTML 全额、最低还款、账单日与年费分开提取',()=>{const b=extractBill({subject:'招商银行信用卡',html:'<table><tr><td>本期应还款额</td><td>人民币 12,345.67</td></tr><tr><td>最低还款额</td><td>1,234.56</td></tr><tr><td>到期还款日</td><td>2026年11月20日</td></tr><tr><td>账单日</td><td>2026-11-01</td></tr></table><p>年费 300 元，刷卡6次减免</p>'},'2026-11-09');assert.equal(b.amount,12345.67);assert.equal(b.minimum_amount,1234.56);assert.equal(b.due_date,'2026-11-20');assert.equal(b.statement_date,'2026-11-01');assert.match(b.annual_fee_info,/刷卡6次/)});
test('只有最低还款时不得冒充全额',()=>{assert.equal(extractBill({text:'中信银行 最低还款额：123.45 到期还款日：2026-11-20'}).amount,null)});
test('零额、千分位与交易明细',()=>{const b=extractBill({text:'交通银行\n本期应还款额：0.00\n最后还款日：2026/11/20\n2026/11/01 | 某商户 | 1,234.56\n2026/11/02 | 退货 | -99.00'});assert.equal(b.amount,0);assert.equal(b.details.length,2);assert.equal(b.details[1].amount,-99)});
test('USD 标签不解析为人民币',()=>{assert.equal(extractBill({text:'招商银行\n本期应还款额：USD 100.00'}).amount,null)});
