import type { init } from 'astro/virtual-modules/prefetch.js';
import Konva from 'konva';

interface ConfigArrow {
    points: number[];
    fill: string;
    stroke: string;
    pointerLength: number;
    pointerWidth: number;
    strokeWidth: number;
    circleColor?: string;
    circleRadius?: number;
}

export class CustomArrow {

    private options: ConfigArrow;
    private stage: Konva.Stage;
    private layer: Konva.Layer;
    private arrow: Konva.Arrow;
    private circle: Konva.Circle;
    private start: { x: number, y: number };
    private end: { x: number, y: number };

    constructor(options: ConfigArrow, layer: Konva.Layer, stage: Konva.Stage) {
        this.options = options;
        this.stage = stage;
        this.layer = layer;
        this.start = { x: this.options.points[0], y: this.options.points[1] };
        this.end = { x: this.options.points[2], y: this.options.points[3] };

        this.arrow = new Konva.Arrow({
            points: this.calculateLinePoints({ x: (this.start.x + this.end.x) / 2, y: (this.start.y + this.end.y) / 2 }),
            pointerLength: this.options.pointerLength,
            pointerWidth: this.options.pointerWidth,
            fill: this.options.fill,
            stroke: this.options.stroke,
            strokeWidth: this.options.strokeWidth,
        });

        this.circle = new Konva.Circle({
            x: (this.start.x + this.end.x) / 2,
            y: (this.start.y + this.end.y) / 2,
            radius: this.options.circleRadius || 7 * this.stage.scaleX(),
            fill: this.options.circleColor || 'white',
            stroke: this.options.stroke,
            strokeWidth: this.options.strokeWidth * this.stage.scaleX(),
            draggable: true,
        });

        this.circle.hide();

        this.circle.on('dragmove', () => {
            this.updateArrow();
            this.layer.draw();
        });

        this.stage.on("wheel", () => {
            this.updateArrow();
            this.layer.draw();
        })

        this.layer.add(this.arrow);
        this.layer.add(this.circle);
    }

    private calculateLinePoints(anchorPos: { x: number, y: number }): number[] {
        const midX = anchorPos.x;
        const midY = anchorPos.y;
        let points: number[] = [];

        points.push(this.start.x, this.start.y);
        points.push(midX, this.start.y);
        points.push(midX, midY);
        points.push(this.end.x, midY);
        points.push(this.end.x, this.end.y);

        return points;
    }

    public updateArrow() {
        const anchorPos = this.circle.position();
        const newPoints = this.calculateLinePoints(anchorPos);
        this.arrow.points(newPoints);
        this.arrow.setAttrs({
            pointerLength: 10 / this.stage.scaleX(),
            pointerWidth: 10 / this.stage.scaleX(),
            strokeWidth: 2 / this.stage.scaleX(),
        });
    }

    public updateAnchors(middlePos: { x: number, y: number }, endPos: { x: number, y: number }, startPos: { x: number, y: number }) {
        this.start = startPos;
        this.end = endPos;
        
        if(middlePos){
            this.circle.position({ x: middlePos.x, y: middlePos.y });
        }
        
        this.updateArrow();
    }

    public initAnchors() {
        this.circle.show();
    }

    public getArrow(): Konva.Arrow {
        return this.arrow;
    }

    public destroyAnchors() {
        this.circle.destroy();
    }
}
