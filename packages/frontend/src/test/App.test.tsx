import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';

// Mock canvas context
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
  fillRect: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  fillText: vi.fn(),
  font: '',
  textAlign: '',
  imageSmoothingEnabled: true,
  drawImage: vi.fn(),
  putImageData: vi.fn(),
} as any);

describe('App', () => {
  it('renders the file drop zone in idle state', () => {
    render(<App />);
    expect(screen.getByText('🗺️ MCPE Mapper')).toBeInTheDocument();
  });

  it('renders file drop instructions', () => {
    render(<App />);
    expect(screen.getByText(/Drop a .mcworld file/)).toBeInTheDocument();
  });

  it('has a backend connection option', () => {
    render(<App />);
    expect(screen.getByText('connect to a backend server')).toBeInTheDocument();
  });

  it('renders the app-container class', () => {
    const { container } = render(<App />);
    expect(container.firstChild).toHaveClass('app-container');
  });
});
