import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

type Props = {
  value: string;
  width?: number;
  height?: number;
  displayValue?: boolean;
};

export const Barcode = ({
  value,
  width = 2,
  height = 60,
  displayValue = false
}: Props) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const normalized = String(value ?? '')
      .replace(/[–—−]/g, '-')
      .replace(/'/g, '-')
      .trim()
      .toUpperCase();

    try {
      // CODE128 handles alphanumeric values with good scanner support.
      JsBarcode(svgRef.current, normalized || 'SIN-CODIGO', {
        format: 'CODE128',
        lineColor: '#000',
        background: '#fff',
        width,
        height,
        margin: 0,
        displayValue,
        fontOptions: 'bold'
      });
    } catch {
      // Avoid crashing the invoice page if barcode generation fails.
      if (svgRef.current) {
        svgRef.current.innerHTML = '';
      }
    }
  }, [value, width, height, displayValue]);

  return <svg ref={svgRef} />;
};
