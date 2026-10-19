// One page of the dev panel.
export interface DevPage {
  id: string;
  title: string;
  render(host: HTMLElement): void;
  dispose?(): void;
}
