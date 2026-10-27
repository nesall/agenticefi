// src/lib/models/Channel.ts
export class Channel {
  private _name: string;
  private _unit: string;
  private _values: number[];
  private _isBoolean: boolean = false;
  private _isNumeric: boolean = true;
  private _isTimestamp: boolean = false;

  constructor(name: string, unit: string = '', values: number[] = []) {
    this._name = name;
    this._unit = unit;
    this._values = values;
  }

  get name(): string { return this._name; }
  get unit(): string { return this._unit; }
  get values(): number[] { return this._values; }
  set values(v: number[]) { this._values = v; }

  get isBoolean(): boolean { return this._isBoolean; }
  setIsBoolean(b: boolean): void { this._isBoolean = b; }

  get isNumeric(): boolean { return this._isNumeric; }
  setIsNumeric(n: boolean): void { this._isNumeric = n; }

  get isTimestamp(): boolean { return this._isTimestamp; }
  setIsTimestamp(t: boolean): void { this._isTimestamp = t; }
}