/** Săgeata arată încotro bate vântul (vântul vine DIN direcția raportată). */
export function WindArrow({ direction }: { direction: number }) {
  return (
    <svg className="wind" viewBox="0 0 24 24" aria-label={`Vânt din ${direction}°`} role="img">
      <g transform={`rotate(${direction + 180} 12 12)`}>
        <path d="M12 3 L12 19 M7 8 L12 3 L17 8" />
      </g>
    </svg>
  );
}
