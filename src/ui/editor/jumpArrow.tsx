import * as React from "react";
import { Store } from "../store";
import {
  QM,
  Location,
  Jump,
  ParamsChanger,
  JumpParameterCondition,
  ParameterChange,
  ParameterShowingType,
} from "../../lib/qmreader";
import { observer } from "mobx-react";
import { observable, computed, runInAction } from "mobx";
import { ReferenceObject, PopperOptions, Modifiers } from "popper.js";
import { EditorStore } from "./store";
import { assertNever } from "../../lib/formula/calculator";
import {
  JUMPS_CONTROL_POINT_DISTANCE,
  JUMP_MARGIN,
  JUMP_HOVER_ZONE_WIDTH,
  JUMPS_LOOP_CONTROL_POINT_DISTANCE,
} from "./consts";
import { colors } from "./colors";
import { InfoPopup, JumpPopupBody } from "./infopopup";

interface Point {
  x: number;
  y: number;
}

@observer
class JumpArrowReal extends React.Component<{
  store: EditorStore;
  jump: Jump;
  start: Point;
  end: Point;
  control1?: Point;
  control2?: Point;
  youAreMoving?: boolean;
}> {
  @observable
  hovered = false;

  @observable
  popupRef: SVGPathElement | null = null;

  render() {
    const { store, jump, control1, control2 } = this.props;

    const pathD = [
      "M",
      this.props.start.x,
      this.props.start.y,
      ...(control1 && control2
        ? ["C", control1.x, control1.y, control2.x, control2.y]
        : control1
        ? ["Q", control1.x, control1.y]
        : ["L"]),

      this.props.end.x,
      this.props.end.y,
    ].join(" ");
    // console.info("Render real jump line", this.props.start.x, this.props.start.y);
    return (
      <>
        <path
          d={pathD}
          stroke={colors.jump.line}
          strokeWidth={(this.hovered && !store.moving) || this.props.youAreMoving ? 3 : 1}
          fill="none"
          markerEnd="url(#arrowBlack)"
        />
        <path
          d={pathD}
          stroke="transparent"
          //stroke="yellow"
          strokeWidth={JUMP_HOVER_ZONE_WIDTH}
          fill="none"
          onMouseEnter={() => {
            // console.info(`Enter jump=${jump.id}`);
            this.hovered = true;
          }}
          onMouseLeave={() => {
            //console.info(`Leave jump=${jump.id}`);
            this.hovered = false;
          }}
          onMouseDown={e => {
            const startLoc = this.props.store.locationById(jump.fromLocationId);

            const endLoc = this.props.store.locationById(jump.toLocationId);
            if (!startLoc || !endLoc) {
              console.error(`Jump id=${jump.id} unable to find locations`);
              return null;
            }

            const x = e.nativeEvent.offsetX;
            const y = e.nativeEvent.offsetY;
            //console.info(`startX=${this.props.start.x} startY=${this.props.start.y}`);
            //console.info(`endX=${this.props.end.x} endY=${this.props.end.y}`);
            //console.info(`Click x=${x} y=${y}`);
            const startDistanceSquare =
              (x - this.props.start.x) ** 2 + (y - this.props.start.y) ** 2;
            const endDistanceSquare = (x - this.props.end.x) ** 2 + (y - this.props.end.y) ** 2;
            const startIsCloser = startDistanceSquare < endDistanceSquare;
            //console.info(`Click, startIsCloser=${startIsCloser}`);
            // asd
            const initialX = startIsCloser ? startLoc.locX : endLoc.locX;
            const initialY = startIsCloser ? startLoc.locY : endLoc.locY;

            store.selected = {
              type: startIsCloser ? "jump_start" : "jump_end",
              id: jump.id,
              initialX,
              initialY,
              currentX: x,
              currentY: y,
              moving: e.shiftKey || store.mouseMode === "move",
              opened: false,
            };
          }}
          onClick={e => {
            // console.info(`Click jump=${jump.id}`);
          }}
          ref={r => {
            if (this.popupRef) {
              return;
            }
            this.popupRef = r;
          }}
        />

        {this.hovered && !store.moving ? (
          <InfoPopup anchorEl={this.popupRef}>
            <JumpPopupBody store={this.props.store} jump={jump} />
          </InfoPopup>
        ) : (
          undefined
        )}
      </>
    );
  }
}

@observer
export class IdleJumpArrow extends React.Component<{
  store: EditorStore;
  jump: Jump;
}> {
  @observable
  start?: Point;
  @observable
  end?: Point;

  render() {
    const store = this.props.store;
    const quest = store.quest;
    const jump = this.props.jump;

    const startLoc = store.locationById(jump.fromLocationId);
    const endLoc = store.locationById(jump.toLocationId);
    if (!startLoc || !endLoc) {
      console.error(`Jump id=${jump.id} unable to find locations`);
      return null;
    }

    const allJumpFromThisLocations = quest.jumps
      .filter(
        x =>
          (x.fromLocationId === jump.fromLocationId && x.toLocationId === jump.toLocationId) ||
          (x.fromLocationId === jump.toLocationId && x.toLocationId === jump.fromLocationId),
      )
      .sort((a, b) => {
        return a.fromLocationId > b.fromLocationId
          ? 1
          : a.fromLocationId < b.fromLocationId
          ? -1
          : a.showingOrder - b.showingOrder;
      });
    const myIndex = allJumpFromThisLocations.findIndex(x => x.id === jump.id);
    if (myIndex < 0) {
      console.error(`Wrong index for jump id=${jump.id}`);
      return null;
    }

    const orientationIsNormal =
      endLoc.locX !== startLoc.locX
        ? endLoc.locX - startLoc.locX > 0
        : endLoc.locY - startLoc.locY > 0;
    const startX = orientationIsNormal ? startLoc.locX : endLoc.locX;
    const endX = orientationIsNormal ? endLoc.locX : startLoc.locX;
    const startY = orientationIsNormal ? startLoc.locY : endLoc.locY;
    const endY = orientationIsNormal ? endLoc.locY : startLoc.locY;
    const allJumpsCount = allJumpFromThisLocations.length;
    const middleVectorX = (endX - startX) / 2;
    const middleVectorY = (endY - startY) / 2;
    const middleX = startX + middleVectorX;
    const middleY = startY + middleVectorY;
    const offsetVectorUnnormalizedX = middleVectorY;
    const offsetVectorUnnormalizedY = -middleVectorX;
    const offsetVectorLength = Math.sqrt(
      offsetVectorUnnormalizedX * offsetVectorUnnormalizedX +
        offsetVectorUnnormalizedY * offsetVectorUnnormalizedY,
    );
    const isBetweenTwoPoints = offsetVectorLength > 0;
    const offsetVectorX = isBetweenTwoPoints
      ? (offsetVectorUnnormalizedX / offsetVectorLength) * JUMPS_CONTROL_POINT_DISTANCE
      : 0;
    const offsetVectorY = isBetweenTwoPoints
      ? (offsetVectorUnnormalizedY / offsetVectorLength) * JUMPS_CONTROL_POINT_DISTANCE
      : 0;

    const offsetVectorCount = myIndex;

    const shiftMultiplier = allJumpsCount > 1 ? (allJumpsCount - 1) / 2 : 0;
    const controlPointX =
      middleX + offsetVectorX * offsetVectorCount - offsetVectorX * shiftMultiplier;
    const controlPointY =
      middleY + offsetVectorY * offsetVectorCount - offsetVectorY * shiftMultiplier;
    const controlPoint1: Point = isBetweenTwoPoints
      ? {
          x: controlPointX,
          y: controlPointY,
        }
      : {
          x: startLoc.locX + JUMPS_LOOP_CONTROL_POINT_DISTANCE,
          y:
            startLoc.locY -
            JUMPS_LOOP_CONTROL_POINT_DISTANCE -
            (myIndex * JUMPS_CONTROL_POINT_DISTANCE) / 2,
        };
    const controlPoint2 = isBetweenTwoPoints
      ? undefined
      : {
          x: startLoc.locX - JUMPS_LOOP_CONTROL_POINT_DISTANCE,
          y:
            startLoc.locY -
            JUMPS_LOOP_CONTROL_POINT_DISTANCE -
            (myIndex * JUMPS_CONTROL_POINT_DISTANCE) / 2,
        };
    // console.info(`Render outmost lineref`);
    return (
      <>
        <path
          d={[
            "M",
            startLoc.locX,
            startLoc.locY,
            ...(!controlPoint2
              ? ["Q", controlPoint1.x, controlPoint1.y]
              : ["C", controlPoint1.x, controlPoint1.y, controlPoint2.x, controlPoint2.y]),
            endLoc.locX,
            endLoc.locY,
          ].join(" ")}
          stroke="transparent"
          strokeWidth={1}
          fill="none"
          ref={lineRef => {
            // console.info(`Got lineRef=`, lineRef);
            if (!lineRef) {
              return;
            }
            const EPSILON = 0.00001;
            const paddedStart = lineRef.getPointAtLength(JUMP_MARGIN);
            const paddedEnd = lineRef.getPointAtLength(lineRef.getTotalLength() - JUMP_MARGIN);
            if (
              !this.start ||
              Math.abs(this.start.x - paddedStart.x) > EPSILON ||
              Math.abs(this.start.y - paddedStart.y) > EPSILON ||
              !this.end ||
              Math.abs(this.end.x - paddedEnd.x) > EPSILON ||
              Math.abs(this.end.y - paddedEnd.y) > EPSILON
            ) {
              runInAction(() => {
                this.start = paddedStart;
                this.end = paddedEnd;
              });
            }
          }}
        />

        {this.start && this.end ? (
          <JumpArrowReal
            store={store}
            jump={jump}
            start={this.start}
            end={this.end}
            control1={controlPoint1}
            control2={controlPoint2}
          />
        ) : null}
      </>
    );
  }
}

@observer
export class JumpArrow extends React.Component<{
  store: EditorStore;
  jump: Jump;
}> {
  render() {
    const store = this.props.store;
    const jump = this.props.jump;

    const startLoc = store.locationById(jump.fromLocationId);
    const endLoc = store.locationById(jump.toLocationId);
    if (!startLoc || !endLoc) {
      console.error(`Jump id=${jump.id} unable to find locations`);
      return null;
    }

    if (
      store.selected &&
      store.moving &&
      store.selected.type === "jump_start" &&
      store.selected.id === jump.id
    ) {
      return (
        <JumpArrowReal
          store={store}
          jump={jump}
          start={{
            x: store.selected.currentX,
            y: store.selected.currentY,
          }}
          end={{
            x: endLoc.locX,
            y: endLoc.locY,
          }}
          youAreMoving={true}
        />
      );
    }

    if (
      store.selected &&
      store.moving &&
      store.selected.type === "jump_end" &&
      store.selected.id === jump.id
    ) {
      return (
        <JumpArrowReal
          store={store}
          jump={jump}
          start={{
            x: startLoc.locX,
            y: startLoc.locY,
          }}
          end={{
            x: store.selected.currentX,
            y: store.selected.currentY,
          }}
          youAreMoving={true}
        />
      );
    }

    return <IdleJumpArrow store={store} jump={jump} />;
  }
}
