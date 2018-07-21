import { PQImages } from "../pqImages";
import { QM, Location, ParamType, ParameterShowingType, ParamCritType, ParameterChange } from "../qmreader";
import { AleaState, Alea } from "../alea";
import { parse } from "../formula";
import { DeepImmutable } from "./deepImmutable";
import { RandomFunc } from "../randomFunc";
import { substitute } from "../substitution";
import { stat } from "fs";
import { JUMP_I_AGREE, JUMP_NEXT, JUMP_GO_BACK_TO_SHIP } from "./defs";
import { assertNever } from "../formula/calculator";

type Quest = DeepImmutable<QM>;
export interface Player {
    Ranger: string;
    Player: string;
    Money: string;
    FromPlanet: string;
    FromStar: string;
    ToPlanet: string;
    ToStar: string;
    lang: Lang,
}
export const DEFAULT_RUS_PLAYER: Player = { // TODO: move from this file
    Ranger: "Греф",
    Player:  "Греф",
    FromPlanet:  "Земля",
    FromStar:  "Солнечная",
    ToPlanet: "Боннасис",
    ToStar: "Процион",
    Money: "65535",
    lang: "rus"
}
export const DEFAULT_ENG_PLAYER: Player = { // TODO: move from this file
    Ranger: "Ranger",
    Player:   "Player",
    FromPlanet:   "FromPlanet",
    FromStar:   "FromStar",
    ToPlanet:  "ToPlanet",
    ToStar:  "ToStar",
    Money: "65535",

    lang: "eng"
}

export interface PlayerSubstitute extends Player { // TODO: move from this file
    Date: string; // Дата дедлайна
    Day: string; // Кол-во дней
    CurDate: string; // Текущая дата
}


export type Lang = 'rus' | 'eng';

export type GameState = DeepImmutable<{
    state:
    | "starting"
    | "location"
    | "jump" // Если переход с описанием и следующая локация не пустая
    | "jumpandnextcrit" // Если переход с описанием и следующая локация не пустая, и параметры достигли критичного
    | "critonlocation" // Параметр стал критичным на локации, доступен только один переход далее
    | "critonlocationlastmessage" // Параметр стал критичным на локации, показывается сообщение последнее
    | "critonjump" // Параметр стал критичным на переходе без описания
    | "returnedending";
    critParamId?: number;
    locationId: number;
    lastJumpId: number | undefined;
    possibleJumps: {
        id: number;
        active: boolean;
    }[];
    paramValues: number[];
    paramShow: boolean[];
    jumpedCount: {
        [jumpId: number]: number;
    };
    locationVisitCount: {
        [locationId: number]: number;
    };
    daysPassed: number;
    imageFilename?: string;

    aleaState: AleaState;
}>;

interface PlayerChoice {
    text: string;
    jumpId: number;
    active: boolean;
}

export interface PlayerState {
    text: string;
    imageFileName?: string;
    paramsState: string[];
    choices: PlayerChoice[];
    gameState: "running" | "fail" | "win" | "dead";
}
const DEFAULT_DAYS_TO_PASS_QUEST = 35;

export function initGame(quest: QM, seed: string): GameState {
    const alea = new Alea(seed);
    for (let i = 0; i < quest.paramsCount; i++) {
        if (quest.params[i].isMoney) {
            const giveMoney = 2000;
            const money =
                quest.params[i].max > giveMoney
                    ? giveMoney
                    : quest.params[i].max;
            quest.params[i].starting = `[${money}]`;
        }
    }

    const startLocation = quest.locations.find(x => x.isStarting);
    if (!startLocation) {
        throw new Error("No start location!");
    }
    const startingParams =quest.params.map((param, index) => {
        return param.active ? parse(param.starting, [], alea.random) : 0;
    });
    const startingShowing = quest.params.map(() => true);

    const state: GameState = {
        state: "starting",
        locationId: startLocation.id,
        lastJumpId: undefined,
        possibleJumps: [],
        paramValues: startingParams,
        paramShow: startingShowing,
        jumpedCount: {},
        locationVisitCount: {},
        daysPassed: 0,
        imageFilename: undefined,
        aleaState: alea.exportState()
    };
        
    return state
}

function SRDateToString(daysToAdd: number, lang: Lang, initialDate: Date = new Date()) {
    const d = new Date(initialDate.getTime() + 1000 * 60 * 60 * 24 * daysToAdd);
    const months = lang === 'eng' ?
        ["January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December"
        ] : [
            "Января",
            "Февраля",
            "Марта",
            "Апреля",
            "Мая",
            "Июня",
            "Июля",
            "Августа",
            "Сентября",
            "Октября",
            "Ноября",
            "Декабря"
        ]
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 1000}`
}

function replace(        
    str: string,     
    state: GameState,
    player: Player,
    diamondIndex: number | undefined,
    random: RandomFunc // Should not be called
) {
    const lang: Lang = player.lang;
    return substitute(
        str,
        {                                        
            Day: `${DEFAULT_DAYS_TO_PASS_QUEST - state.daysPassed}`,
            Date: SRDateToString(DEFAULT_DAYS_TO_PASS_QUEST, lang),
            CurDate: SRDateToString(state.daysPassed, lang),
            lang: lang,
            ...player
        },
        state.paramValues,
        random,
        diamondIndex
    );
}

function getParamsState(quest: Quest, state: GameState, player: Player, random: RandomFunc ) {
    const paramsState: string[] = [];
    for (let i = 0; i < quest.paramsCount; i++) {
        if (state.paramShow[i] && quest.params[i].active) {
            const val = state.paramValues[i];
            const param = quest.params[i];
            if (val !== 0 || param.showWhenZero) {
                for (const range of param.showingInfo) {
                    if (val >= range.from && val <= range.to) {
                        let str = replace(                            
                            range.str, 
                            state,
                            player,
                            i,
                            random
                        );
                        paramsState.push(str);                            
                        break;
                    }
                }
            }
        }
    }
    return paramsState;
}

function calculateLocationShowingTextId(state: GameState, location: DeepImmutable<Location>, random: RandomFunc) {
    const locationTextsWithText = location.texts
        .map((text, i) => {
            return { text, i };
        })
        .filter(x => x.text);

    if (location.textSelectFurmula) {
        if (location.textSelectFurmula) {            
            const id =
                parse(location.textSelectFurmula, state.paramValues, random) -
                1;
            if (location.texts[id]) {
                return id;
            } else {
                console.warn(`Location id=${location.id} formula result textid=${id}, but no text`)
                return 0; // Tge 4 and 5 shows different here. We will show location text 0
            }
        } else {
            console.warn(`Location id=${location.id} text by formula is set, but no formula`);
            const textNum = random(locationTextsWithText.length);
            
            return (
                (locationTextsWithText[textNum] &&
                    locationTextsWithText[textNum].i) ||
                0
            );
        }
    } else {
        const textNum =
            locationTextsWithText.length > 0
                ? state.locationVisitCount[location.id] %
                locationTextsWithText.length
                : 0;

        return (
            (locationTextsWithText[textNum] &&
                locationTextsWithText[textNum].i) ||
            0
        );
    }
}

export function getUIState(quest: Quest, state: GameState, player: Player): PlayerState {
    const alea = new Alea(state.aleaState.slice());
    const random = alea.random;

    const texts = player.lang === "rus"
    ? {
        iAgree: "Я берусь за это задание",
        next: "Далее",
        goBackToShip: "Вернуться на корабль"
    }
    : {
        iAgree: "I agree",
        next: "Next",
        goBackToShip: "Go back to ship"
    };


    if (state.state === "starting") {
        return {
            text: replace(quest.taskText, state, player, undefined, random),
            paramsState: [],
            choices: [
                {
                    jumpId: JUMP_I_AGREE,
                    text: texts.iAgree,
                    active: true
                }
            ],
            gameState: "running"
        };
    } else if (state.state === "jump") {
        const jump = quest.jumps.find(
            x => x.id === state.lastJumpId
        );
        if (!jump) {
            throw new Error(`Internal error: no last jump id=${state.lastJumpId}`);
        }
        return {
            text: replace(jump.description, state, player, undefined, alea.random),
            paramsState: getParamsState(quest, state, player, random),
            choices: [
                {
                    jumpId: JUMP_NEXT,
                    text: texts.next,
                    active: true
                }
            ],
            gameState: "running",
            imageFileName: state.imageFilename
        };
    } else if (
        state.state === "location" ||
        state.state === "critonlocation"
    ) {
        const location = quest.locations.find(
            x => x.id === state.locationId
        );
        if (!location) {
            throw new Error(`Internal error: no state loc id=${state.locationId}`);
        }

        const locTextId = calculateLocationShowingTextId(state, location, random);
        const textInOptions = location.texts[locTextId] || "";

        const lastJump = quest.jumps.find(
            x => x.id === state.lastJumpId
        );

        const text =
            location.isEmpty && lastJump && lastJump.description
                ? lastJump.description
                : textInOptions;

        return {
            text: replace(text, state, player, undefined, alea.random),
            paramsState: getParamsState(quest, state, player, random),
            choices:
                state.state === "location"
                    ? location.isFaily || location.isFailyDeadly
                        ? []
                        : location.isSuccess
                            ? [
                                {
                                    jumpId: JUMP_GO_BACK_TO_SHIP,
                                    text: texts.goBackToShip,
                                    active: true
                                }
                            ]
                            : state.possibleJumps.map(x => {
                                const jump = quest.jumps.find(
                                    y => y.id === x.id
                                );
                                if (!jump) {
                                    throw new Error(`Internal error: no jump ${x.id} in possible jumps`);
                                }
                                return {
                                    text:
                                        replace(jump.text, state, player, undefined, alea.random) ||
                                        texts.next,
                                    jumpId: x.id,
                                    active: x.active
                                };
                            })
                    : [
                        {
                            // critonlocation
                            jumpId: JUMP_NEXT,
                            text: texts.next,
                            active: true
                        }
                    ],

            gameState: location.isFailyDeadly
                ? "dead"
                : location.isFaily ? "fail" : "running",
            imageFileName: state.imageFilename
        };
    } else if (state.state === "critonjump") {
        const critId = state.critParamId;
        const jump = quest.jumps.find(
            x => x.id === state.lastJumpId
        );

        if (critId === undefined || !jump) {
            throw new Error(
                `Internal error: crit=${critId} lastjump=${state
                    .lastJumpId}`
            );
        }
        const param = quest.params[critId];
        return {
            text: replace(
                jump.paramsChanges[critId].critText ||
                quest.params[critId].critValueString,
                state, player, undefined, alea.random
            ),
            paramsState: getParamsState(quest, state, player, random),
            choices:
                param.type === ParamType.Успешный
                    ? [
                        {
                            jumpId: JUMP_GO_BACK_TO_SHIP,
                            text: texts.goBackToShip,
                            active: true
                        }
                    ]
                    : [],
            gameState:
                param.type === ParamType.Успешный
                    ? "running"
                    : param.type === ParamType.Провальный ? "fail" : "dead",
            imageFileName: state.imageFilename
        };
    } else if (state.state === "jumpandnextcrit") {
        const critId = state.critParamId;
        const jump = quest.jumps.find(
            x => x.id === state.lastJumpId
        );
        if (critId === undefined || !jump) {
            throw new Error(
                `Internal error: crit=${critId} lastjump=${state
                    .lastJumpId}`
            );
        }

        const param = quest.params[critId];
        return {
            text: replace(jump.description, state, player, undefined, alea.random),
            paramsState: getParamsState(quest, state, player, random),
            choices: [
                {
                    jumpId: JUMP_NEXT,
                    text: texts.next,
                    active: true
                }
            ],
            gameState: "running",
            imageFileName: state.imageFilename
        };
    } else if (state.state === "critonlocationlastmessage") {
        const critId = state.critParamId;
        const location = quest.locations.find(
            x => x.id === state.locationId
        );

        if (critId === undefined) {
            throw new Error(`Internal error: no critId`);
        }
        if (!location) {
            throw new Error(`Internal error: no crit state location ${state.locationId}`);
        }
        const param = quest.params[critId];

        return {
            text: replace(
                location.paramsChanges[critId].critText ||
                quest.params[critId].critValueString,
                state, player, undefined, alea.random
            ),
            paramsState: getParamsState(quest, state, player, random),
            choices:
                param.type === ParamType.Успешный
                    ? [
                        {
                            jumpId: JUMP_GO_BACK_TO_SHIP,
                            text: texts.goBackToShip,
                            active: true
                        }
                    ]
                    : [],
            gameState:
                param.type === ParamType.Успешный
                    ? "running"
                    : param.type === ParamType.Провальный ? "fail" : "dead",
            imageFileName: state.imageFilename
        };
    } else if (state.state === "returnedending") {
        return {
            text: replace(quest.successText,  state, player, undefined, alea.random),
            paramsState: [],
            choices: [],
            gameState: "win"
        };
    } else {
        return assertNever(state.state);        
    }
}



function calculateParamsUpdate(quest: Quest, stateOriginal: GameState, random: RandomFunc,
    paramsChanges: ReadonlyArray<ParameterChange>) {
    let critParamsTriggered: number[] = [];
    let state = stateOriginal;
    let oldValues = state.paramValues.slice(0, quest.paramsCount);
    let newValues = state.paramValues.slice(0, quest.paramsCount);

    for (let i = 0; i < quest.paramsCount; i++) {
        const change = paramsChanges[i];
        if (change.showingType === ParameterShowingType.Показать) {
            const paramShow = state.paramShow.slice();
            paramShow[i] = true;
            state = {
                ...state,
                paramShow
            }
        } else if (change.showingType === ParameterShowingType.Скрыть) {
            const paramShow = state.paramShow.slice();
            paramShow[i] = false;
            state = {
                ...state,
                paramShow
            }
        }

        if (change.isChangeValue) {
            newValues[i] = change.change;
        } else if (change.isChangePercentage) {
            newValues[i] = Math.round(
                oldValues[i] * (100 + change.change) / 100
            );
        } else if (change.isChangeFormula) {
            if (change.changingFormula) {
                newValues[i] = parse(change.changingFormula, oldValues, random);
            }
        } else {
            newValues[i] = oldValues[i] + change.change;
        }

        const param = quest.params[i];
        if (newValues[i] > param.max) {
            newValues[i] = param.max;
        }
        if (newValues[i] < param.min) {
            newValues[i] = param.min;
        }

        if (
            newValues[i] !== oldValues[i] &&
            param.type !== ParamType.Обычный
        ) {
            if (
                (param.critType === ParamCritType.Максимум &&
                    newValues[i] === param.max) ||
                (param.critType === ParamCritType.Минимум &&
                    newValues[i] === param.min)
            ) {
                critParamsTriggered.push(i);
            }
        }
    }
    state = {
        ...state,
        paramValues: newValues
    }    
    return {state, critParamsTriggered}
}



export function performJump(jumpId: number, quest: Quest, stateOriginal: GameState, images: PQImages = []): GameState {
    const alea = new Alea(stateOriginal.aleaState.slice());
    const random = alea.random;
    let state = stateOriginal;

    if (jumpId === JUMP_GO_BACK_TO_SHIP) {        
        return {
            ...state,
            state: "returnedending",
            aleaState: alea.exportState(),
        };
    }

    const jumpForImg = quest.jumps.find(
        x => x.id === state.lastJumpId
    );
    const image =
        jumpForImg && jumpForImg.img
            ? jumpForImg.img.toLowerCase() + ".jpg"
            : images
                .filter(
                x => !!x.jumpIds && x.jumpIds.indexOf(jumpId) > -1
                )
                .map(x => x.filename)
                .shift();
    if (image) {
        state = {
            ...state,
            imageFilename: image,
        }        
    }
    
    if (state.state === "starting") {
        state = {
            ...state,
            state: "location",
        }        
        state = calculateLocation(state);
    } else if (state.state === "jump") {
        const jump = quest.jumps.find(
            x => x.id === state.lastJumpId
        );
        if (!jump) {
            throw new Error(`Internal error: no jump ${state.lastJumpId}`);
        }
        state = {
            ...state,
            locationId: jump.toLocationId,
            state: "location",
        }                
        state = calculateLocation(state);
    } else if (state.state === "location") {
        if (!state.possibleJumps.find(x => x.id === jumpId)) {
            throw new Error(
                `Jump ${jumpId} is not in list in that location`
            );
        }
        const jump = quest.jumps.find(x => x.id === jumpId);
        if (!jump) {
            throw new Error(`"Internal Error: no jump id=${jumpId} from possible jump list`);
        }
        state = {
            ...state,
            lastJumpId: jumpId,
        }        
        if (jump.dayPassed) {
            state = {
                ...state,
                daysPassed: state.daysPassed + 1,
            }               
        }
        state = {
            ...state,
            jumpedCount: {
                ...state.jumpedCount,
                [jumpId]: (state.jumpedCount[jumpId] || 0) + 1,
            }
        }
        

        const paramsUpdate = calculateParamsUpdate(
            quest,
            state,
            random,
            jump.paramsChanges
        );
        state = paramsUpdate.state;
        const critParamsTriggered = paramsUpdate.critParamsTriggered;

        const nextLocation = quest.locations.find(
            x => x.id === jump.toLocationId
        );
        if (!nextLocation) {
            throw new Error(`Internal error: no next location ${jump.toLocationId}`);
        }

        if (!jump.description) {
            if (critParamsTriggered.length > 0) {
                const critParamId = critParamsTriggered[0];
                state = {
                    ...state,
                    state: "critonjump",
                    critParamId,
                }
                
                
                const qmmImage =
                    (state.critParamId !== undefined &&
                        jump.paramsChanges[state.critParamId].img) ||
                    quest.params[critParamId].img;
                const image = qmmImage
                    ? qmmImage.toLowerCase() + ".jpg"
                    : images
                        .filter(
                        x =>
                            !!x.critParams &&
                            x.critParams.indexOf(state
                                .critParamId as number) > -1
                        )
                        .map(x => x.filename)
                        .shift();
                if (image) {
                    state = {
                        ...state,
                        imageFilename: image,
                    }
                }
            } else {
                state = {
                    ...state,
                    locationId: nextLocation.id,
                    state: "location",
                }                
                state = calculateLocation(state);
            }
        } else {
            if (critParamsTriggered.length > 0) {
                state = {
                    ...state,
                    state: "jumpandnextcrit",
                    critParamId: critParamsTriggered[0],
                }
            } else if (nextLocation.isEmpty) {
                state = {
                    ...state,
                    locationId: nextLocation.id,
                    state: "location",
                }
                state = calculateLocation(state);
            } else {
                state = {
                    ...state,
                    state: "jump"
                }                
            }
        }
    } else if (state.state === "jumpandnextcrit") {
        state = {
            ...state,
            state: "critonjump"
        }
        const jump = quest.jumps.find(
            x => x.id === state.lastJumpId
        );
        const qmmImg =
            (state.critParamId !== undefined &&
                jump &&
                jump.paramsChanges[state.critParamId].img) ||
            (state.critParamId !== undefined &&
                quest.params[state.critParamId].img);
        const image = qmmImg
            ? qmmImg.toLowerCase() + ".jpg"
            : images
                .filter(
                x =>
                    !!x.critParams &&
                    state.critParamId !== undefined &&
                    x.critParams.indexOf(state
                        .critParamId) > -1
                )
                .map(x => x.filename)
                .shift();

        if (image) {
            state = {
                ...state,
                imageFilename: image,
            }            
        }
    } else if (state.state === "critonlocation") {
        state = {
            ...state,
            state:  "critonlocationlastmessage",
        }        
    } else {
        throw new Error(`Unknown state ${state.state} in performJump`);
    }

    return {
        ...state,
        aleaState: alea.exportState(),
    };
}