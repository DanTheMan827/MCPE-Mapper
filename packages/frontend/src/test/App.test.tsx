import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';

// Mock WebSocket to prevent auto-connect attempts
vi.stubGlobal('WebSocket', vi.fn().mockImplementation(() => ({
  close: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  onopen: null,
  onclose: null,
  onerror: null,
  onmessage: null,
})));

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
  it('shows checking indicator while probing backend', () => {
    render(<App />);
    expect(screen.getByText('Checking for backend...')).toBeInTheDocument();
  });

  it('does not show file drop zone while checking for backend', () => {
    render(<App />);
    expect(screen.queryByText('🗺️ MCPE Mapper')).not.toBeInTheDocument();
  });

  it('does not show backend connection option', () => {
    render(<App />);
    expect(screen.queryByText('connect to a backend server')).not.toBeInTheDocument();
  });

  it('renders the app-container class', () => {
    const { container } = render(<App />);
    expect(container.firstChild).toHaveClass('app-container');
  });
});
