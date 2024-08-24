import Konva from 'konva';

interface PickerConfig {
    blockWidth: number;
    blockHeight: number;
    stripWidth: number;
}

export class PickerCustom {
    private stage: Konva.Stage;
    private layer: Konva.Layer;
    private layerUtilities: Konva.Layer;
    private colorBlock: Konva.Rect;
    private colorStrip: Konva.Rect;
    private selectedColor: string;
    private colorPreview: Konva.Rect;
    private picker: Konva.Circle;
    private gradientWhite: Konva.Rect;
    private gradientBlack: Konva.Rect;
    private pos: { x: number, y: number } = { x: 0, y: 0 };
    private drag: boolean;
    private dragPicker: boolean;
    private config: PickerConfig;
    private umbralSeparation: number = 10;

    constructor(stage: Konva.Stage, layer: Konva.Layer, layerUtilities: Konva.Layer, config: PickerConfig) {
        this.stage = stage;
        this.layer = layer;
        this.layerUtilities = layerUtilities;
        this.drag = false;
        this.dragPicker = false;
        this.selectedColor = 'rgba(255,255,0,1)';
        this.config = config;

        this.initPicker();
    }

    private initPicker() {
        this.pos = { x: this.stage.getRelativePointerPosition()?.x || 0, y: this.stage.getRelativePointerPosition()?.y || 0 };

        this.colorStrip = new Konva.Rect({
            x: this.pos.x + this.config.blockWidth + this.umbralSeparation,
            y: this.pos.y,
            width: this.config.stripWidth,
            height: this.config.blockHeight,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: this.config.blockHeight },
            fillLinearGradientColorStops: [
                0, 'rgba(255, 0, 0, 1)',
                0.17, 'rgba(255, 255, 0, 1)',
                0.34, 'rgba(0, 255, 0, 1)',
                0.51, 'rgba(0, 255, 255, 1)',
                0.68, 'rgba(0, 0, 255, 1)',
                0.85, 'rgba(255, 0, 255, 1)',
                1, 'rgba(255, 0, 0, 1)'
            ],
            visible: false,
            block: true,
        });
        this.layerUtilities.add(this.colorStrip);

        this.colorBlock = new Konva.Rect({
            x: this.pos.x,
            y: this.pos.y,
            width: this.config.blockWidth,
            height: this.config.blockHeight,
            fill: 'rgba(255,255,0,1)',
            visible: false,
            block: true,
            pick: true,
        });
        this.layerUtilities.add(this.colorBlock);

        this.colorPreview = new Konva.Rect({
            x: this.pos.x + this.config.blockWidth + this.umbralSeparation + this.config.stripWidth + this.umbralSeparation,
            y: this.pos.y,
            width: 50,
            height: 50,
            fill: 'rgba(255,255,0,1)',
            visible: false,
            block: true,
        });
        this.layerUtilities.add(this.colorPreview);

        this.fillGradient();

        this.colorStrip.on("click", (e) => this.pickHue(e, this.picker));
        this.colorStrip.on('mousedown', (e) => this.startDrag(e));
        this.colorStrip.on('mouseup', () => this.stopDrag());
        this.colorStrip.on('mousemove', (e) => this.onDrag(e));
        this.stage.on('mousedown', (e) => this.startPickHue(e));
        this.stage.on('mousemove', (e) => this.pickHue(e, this.stage));
        this.stage.on('mouseup', () => this.endPickHue());

        this.layerUtilities.batchDraw();
    }

    private fillGradient() {
        const blockWidth = this.colorBlock.width();
        const blockHeight = this.colorBlock.height();

        this.gradientWhite = new Konva.Rect({
            x: this.pos.x,
            y: this.pos.y,
            width: blockWidth,
            height: blockHeight,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: blockWidth, y: 0 },
            fillLinearGradientColorStops: [0, 'rgba(255,255,255,1)', 1, 'rgba(255,255,255,0)'],
            visible: false,
            block: true,
            pick: true,
        });
        this.layerUtilities.add(this.gradientWhite);

        this.gradientBlack = new Konva.Rect({
            x: this.pos.x,
            y: this.pos.y,
            width: blockWidth,
            height: blockHeight,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: blockHeight },
            fillLinearGradientColorStops: [0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,1)'],
            visible: false,
            block: true,
            pick: true,
        });
        this.layerUtilities.add(this.gradientBlack);

        this.picker = new Konva.Circle({
            x: this.pos.x,
            y: this.pos.y,
            radius: 5,
            fill: 'red',
            visible: false,
            listening: false,
            draggable: false,
        });
        // this.layer.add(this.picker);
    }

    private startPickHue(e: Konva.KonvaEventObject<MouseEvent>) {
        if(e.target.getAttr("pick") == undefined) return;

        this.dragPicker = true;
        this.pickHue(e, this.stage);
    }

    private pickHue(e: Konva.KonvaEventObject<MouseEvent>, element: Konva.Circle | Konva.Stage) {
        if (this.dragPicker || element == this.picker) {
            const pos = element instanceof Konva.Stage ? element.getPointerPosition() : element.absolutePosition();
            const posRelative = element instanceof Konva.Stage ? element.getRelativePointerPosition() : element.position();

            if (!pos || !posRelative || (e.target.getAttr("pick") == undefined && element != this.picker)) return;

            const imageData = this.layerUtilities.getContext().getImageData(pos.x, pos.y, 1, 1).data;
            const rgbaColor = `rgba(${imageData[0]}, ${imageData[1]}, ${imageData[2]}, 1)`;

            this.picker.position({
                x: posRelative.x,
                y: posRelative.y,
            });

            this.colorPreview.fill(rgbaColor);
            this.layerUtilities.batchDraw();
        }
    }

    private endPickHue() {
        this.dragPicker = false;
    }

    private startDrag(e: Konva.KonvaEventObject<MouseEvent>) {
        this.drag = true;
        this.changeColor(e);
    }

    private stopDrag() {
        this.drag = false;
    }

    private onDrag(e: Konva.KonvaEventObject<MouseEvent>) {
        if (this.drag) {
            this.changeColor(e);
        }
    }

    private changeColor(e: Konva.KonvaEventObject<MouseEvent>) {
        const pos = this.stage.getPointerPosition();
        if (!pos) return;

        const imageData = this.layerUtilities.getContext().getImageData(pos.x, pos.y, 1, 1).data;
        const rgbaColor = `rgba(${imageData[0]}, ${imageData[1]}, ${imageData[2]}, 1)`;

        this.colorBlock.fill(rgbaColor);
        this.layerUtilities.batchDraw();
        this.pickHue(e, this.picker);
    }

    public changePos(pos: { x: number, y: number }) {
        this.pos = pos;

        this.colorBlock.position(pos);
        this.colorStrip.position({ x: pos.x + this.config.blockWidth + this.umbralSeparation, y: pos.y });
        this.colorPreview.position({ x: pos.x + this.config.blockWidth + this.umbralSeparation + this.config.stripWidth + this.umbralSeparation, y: pos.y });
        this.gradientWhite.position(pos);
        this.gradientBlack.position(pos);
        this.picker.position(pos);

        this.colorBlock.visible(true);
        this.colorStrip.visible(true);
        this.colorPreview.visible(true);
        this.gradientWhite.visible(true);
        this.gradientBlack.visible(true);
        this.picker.visible(true);

        this.layerUtilities.batchDraw();
    }
}
