import * as vscode from 'vscode';
import { Rules, Rule, Capture } from './rules';
import { MatchPositions, UnmatchedText } from './matchPositions';
import { MultiRegExp2, MultiRegExMatch } from './multiRegExp2';

export interface Line {
    text: string,
    matchPositions: MatchPositions,
    elements: Element[],
    blockElements: BlockElement[],
}

export interface Element {
    type: ElementType,
    text: string,
    start: number,
    end: number
}

export interface BlockElement {
    level: number,
    index: number,
    type: BlockElementType,
    text: string,
    start: number,
    end: number
}

export enum ElementType {
    none,
    word,
    operater,
    punctRightSpace,
    punctLeftSpace,
    connector,
    asIs,
}

export enum BlockElementType {
    blockStart,
    blockAgain,
    blockEnd,
}

class Position {
    private _lineText: string
    private _match: string
    constructor(public line: number, public position: number, match: string) {
        this._match = match;
    }
    get positionAtMatchLeft(): Position {
        let pos = new Position(
            this.line,
            this.position - this._match.length,
            ""
        )
        return pos;
    }
    get positionAtMatchRight(): Position {
        let pos = new Position(
            this.line,
            this.position + this._match.length,
            ""
        )
        return pos;
    }
}
export class Analyst {
    private _lines: Line[];
    private _rules: Rules;
    private _blockLevel = 0;
    constructor(lines: string[], rules: Rules) {
        this._lines = lines.map(v => {
            return <Line>{
                text: v,
                matchPositions: new MatchPositions(v),
                elements: [],
                blockElements: []
            }
        });
        this._rules = rules;
    }
    get lines(): Line[] {
        return this._lines;
    }
    analysis() {
        let rules: Rule[] = this._rules.rootRules;
        this.match(rules);
        this._lines.map(v => {
            makeLineElements(v);
        });
        function makeLineElements(line: Line) {
            if (line.elements.length) line.elements.sort((a, b) => a.start - b.start);
            let pos = 0;
            let els: Element[] = [];
            for (let e of line.elements) {
                if (e.start > pos && line.text.substring(pos, e.start).trim()) els.push({
                    type: ElementType.none,
                    text: line.text.substring(pos, e.start),
                    start: pos,
                    end: e.start - 1
                });
                pos = e.end + 1;
            }
            if (pos < line.text.length && line.text.substring(pos, line.text.length).trim()) {
                els.push({
                    type: ElementType.none,
                    text: line.text.substring(pos, line.text.length),
                    start: pos,
                    end: line.text.length - 1
                });
            }
            line.elements.push(...els);
            if (line.elements.length) line.elements.sort((a, b) => a.start - b.start);
        }
    }
    private match(rules: Rule[], start?: Position, stopRule?: Rule): Position {
        let matchStartPos = new Position(0, 0, "");
        let blockEndPos: Position;
        if (start) matchStartPos = start.positionAtMatchRight;
        let blockStartPos: Position;

        for (let rule of rules) {
            //test match    
            if (rule.match) {
                this.doMatch(rule, matchStartPos, stopRule);
            }
            //test block in
            else if (rule.begin && rule.end) {
                let blockIndex = 0;
                while (blockStartPos = this.doBeginMatch(rule, matchStartPos, stopRule, ++blockIndex)) {
                    // return if find stop
                    blockEndPos = this.doEndMatch(rule, matchStartPos.positionAtMatchRight, blockIndex);
                    if (blockEndPos) this.markElementsInBlock(rule.patterns.type ? rule.patterns.type : ElementType.none, blockStartPos.positionAtMatchRight, blockEndPos.positionAtMatchLeft);
                }
            }
        }
        return blockEndPos;
    }
    private doMatch(rule: Rule, start?: Position, stopRule?: Rule) {
        if (!rule.match) return;
        for (let i = 0; i < this._lines.length; i++) {
            if (start && start.line > i) continue;
            let line = this._lines[i];
            for (let u of line.matchPositions.GetUnmatchedTexts()) {
                if (start && start.line == i && start.position > u.offset + u.text.length - 1) continue;
                if (!u.text.trim()) continue;
                // console.log("test", u.text, "with", patt.regExp.source);
                let matches: MultiRegExMatch[] = [];

                let shouldEndAt = u.text.length;
                let hasEnd = false;
                if (stopRule) {
                    stopRule.end.regExp.lastIndex = 0;
                    if (matches = stopRule.end.execForAllGroups(u.text, false)) {
                        // console.log("stop:", rule.comment, "by:", matches[0].match, "at", i, ":", matches[0].start + u.offset - 1);
                        shouldEndAt = matches[0].start;
                        hasEnd = true;
                    }
                }
                rule.match.regExp.lastIndex = 0;
                while (matches = rule.match.execForAllGroups(u.text, false)) {
                    //in-block match should not reach the end sign, or it's a invalid match
                    if (matches[0].end < shouldEndAt) {
                        // console.log("TEST", u.text, "MATCH", matches[0].match, "WITH", rule.match.regExp.source);
                        this.markElement(line, matches, rule.captures, u.offset);
                    }
                }
                // return if find stop
                if (hasEnd) return;
            }
        }
    }
    private doBeginMatch(rule: Rule, start: Position, stopRule: Rule, blockIndex: number): Position {
        if (!rule.begin || !rule.end) return;
        let beginAt: Position;
        let hasFindBegin: boolean = false;
        for (let i = start ? start.line : 0; i < this._lines.length; i++) {
            let line = this._lines[i];
            for (let u of line.matchPositions.GetUnmatchedTexts()) {
                rule.begin.regExp.lastIndex = 0;
                if (rule.again) rule.again.regExp.lastIndex = 0;
                rule.end.regExp.lastIndex = 0;
                if (start && start.line == i && start.position > u.offset + u.text.length - 1) continue;
                if (!u.text.trim()) continue;
                let matches: MultiRegExMatch[] = [];

                let shouldEndAt = u.text.length;
                let hasEnd = false;
                let endMatch = "";
                if (stopRule) {
                    stopRule.end.regExp.lastIndex = 0;
                    if (matches = stopRule.end.execForAllGroups(u.text, false)) {
                        // console.log("stop:", rule.comment, "by:", matches[0].match, "at", i, ":", matches[0].start + u.offset - 1);
                        shouldEndAt = matches[0].start;
                        hasEnd = true;
                        endMatch = matches[0].match;
                    }
                }

                //find begin
                if (matches = rule.begin.execForAllGroups(u.text, false)) {
                    //in-block match should not reach the end sign, or it's a invalid match
                    if (matches[0].end < shouldEndAt) {
                        hasFindBegin = true;
                        beginAt = new Position(i, matches[0].start + u.offset, matches[0].match);
                        this._blockLevel++;
                        console.log("ENTER BLOCK LEVEL", this._blockLevel, "INDEX", blockIndex, "OF", rule.comment, "BY", matches[0].match, "AT", beginAt.line, beginAt.position);
                        this.markElement(line, matches, rule.beginCaptures, u.offset);
                        this.markBlockElement(line, rule, BlockElementType.blockStart, this._blockLevel, blockIndex, matches, u.offset);
                        let blockRules = this._rules.getPatternRules(rule.patterns);
                        //current rule must be the first to match the sub block
                        if (blockRules.length) {
                            blockRules.unshift(rule);
                            let lastEnd: Position;
                            while (lastEnd = this.match(blockRules, beginAt, rule)) {
                                if (lastEnd) beginAt = lastEnd;
                            }
                        }
                    }
                    // if (stopRule) return this.doEndMatch(stopRule, beginAt.positionAtMatchRight);
                }

                //find again
                if (!beginAt && rule.again) {
                    if (matches = rule.again.execForAllGroups(u.text, false)) {
                        this.markElement(line, matches, rule.beginCaptures, u.offset);
                        this.markBlockElement(line, rule, BlockElementType.blockAgain, this._blockLevel, blockIndex, matches, u.offset);
                        console.log("FIND AGAIN", "OF LEVEL", this._blockLevel, "INDEX", blockIndex, "BY", matches[0].match, "AT", i, matches[0].start + u.offset)
                    }
                }
                if (hasEnd || hasFindBegin) return beginAt;
            }
        }
        return beginAt;
    }
    private doEndMatch(rule: Rule, start: Position, blockIndex: number): Position {
        if (!rule || !rule.begin || !rule.end) return start;
        for (let i = start ? start.line : 0; i < this._lines.length; i++) {
            let line = this._lines[i];
            for (let u of line.matchPositions.GetUnmatchedTexts()) {
                rule.end.regExp.lastIndex = 0;
                if (start && start.line == i && start.position > u.offset + u.text.length - 1) continue;
                // console.log("test rule", u.text, "with", rule.comment);
                let matches: MultiRegExMatch[] = [];
                if (matches = rule.end.execForAllGroups(u.text, false)) {
                    this.markElement(line, matches, rule.endCaptures, u.offset);
                    this.markBlockElement(line, rule, BlockElementType.blockEnd, this._blockLevel, blockIndex, matches, u.offset);
                    // console.log("Find end:", matches[0].match, "at", i, ":", matches[0].start + u.offset - 1);
                    let endAt = new Position(i, matches[0].start + u.offset, matches[0].match);
                    this._blockLevel--;
                    console.log("LEAVE BLOCK LEVEL", this._blockLevel + 1, "INDEX", blockIndex, "FROM", rule.comment, "BY", matches[0].match, "AT", endAt.line, endAt.position);
                    return endAt;
                }
            }
        }
        console.log("WARNING: LEAVE BLOCK LEVEL", this._blockLevel--, "FROM", rule.comment, "DUE TO EOF.");
    }
    private markElement(line: Line, matches: MultiRegExMatch[], captures: Capture[], offset: number) {
        // console.log(matches[0].match);
        line.matchPositions.AddPosition(matches[0].start, matches[0].end, offset);
        if (captures) {
            for (let capture of captures) {
                if (matches[capture.index] && matches[capture.index].match) line.elements.push(
                    <Element>{
                        type: capture.type,
                        text: matches[capture.index].match,
                        start: matches[capture.index].start + offset,
                        end: matches[capture.index].end + offset,
                    }
                );
            }
        } else {
            line.elements.push(
                <Element>{
                    type: ElementType.none,
                    text: matches[0].match,
                    start: matches[0].start + offset,
                    end: matches[0].end + offset,
                }
            );
        }
    }
    private markElementsInBlock(type: ElementType, start: Position, end: Position) {
        // console.log("markElementsInBlock, from", start.line + ":" + start.position, "to", end.line + ":" + end.position);
        for (let i = start ? start.line : 0; i <= end.line; i++) {
            let line = this._lines[i];
            for (let u of line.matchPositions.GetUnmatchedTexts()) {
                if (start && start.line == i && start.position > u.offset + u.text.length - 1) continue;
                if (end && end.line == i && end.position < u.offset + u.text.length - 1) continue;
                // console.log("test rule", u.text, "with", rule.comment);
                if (!u.text.trim()) continue;
                line.matchPositions.AddPosition(0, u.text.length - 1, u.offset);
                line.elements.push(<Element>{
                    type: type,
                    text: u.text,
                    start: u.offset,
                    end: u.text.length - 1 + u.offset
                });
            }
        }
    }
    private markBlockElement(line: Line, rule: Rule, type: BlockElementType, blockLevel, blockIndex: number, matches: MultiRegExMatch[], offset: number) {
        if (!rule.isBlock) return;
        line.blockElements.push(
            <BlockElement>{
                level: blockLevel,
                index: blockIndex,
                type: type,
                text: matches[0].match,
                start: matches[0].start + offset,
                end: matches[0].end + offset,
            }
        );
    }
}