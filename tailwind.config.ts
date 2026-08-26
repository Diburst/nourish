import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: '#FAFAF8',
        card: '#FFFFFF',
        hairline: '#E7E5E1',
        ink: '#1C1C1A',
        muted: '#8A8880',
        bar: 'var(--th-track)',
        barfill: 'var(--th-fill)',
        wash: 'var(--th-wash)',
        'ok-bg': '#E6F4EA',
        'ok-fg': '#2E7D46',
        'fail-bg': '#FBEAEA',
        'fail-fg': '#B3413E',
        'wip-bg': '#FBF3DC',
        'wip-fg': '#9A7B24',
      },
      maxWidth: { column: '560px' },
    },
  },
  plugins: [],
};
export default config;
