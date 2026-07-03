export function glow(ctx: CanvasRenderingContext2D, color: string, blur: number): void {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
}

export function noGlow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}
