import { ImageResponse } from 'next/og';

export const dynamic = 'force-static';

export function GET() {
  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        background: '#f5f5f7',
        color: '#1d1d1f',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 80,
        fontSize: 76,
        textAlign: 'center',
      }}
    >
      Government job notification
    </div>,
    { width: 1200, height: 630 },
  );
}
