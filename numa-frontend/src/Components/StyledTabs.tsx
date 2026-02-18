import { Tabs, type TabsProps } from 'react-bootstrap';

const joinClassNames = (...classes: Array<string | undefined>) => classes.filter(Boolean).join(' ');

export function StyledTabs({ className, ...props }: TabsProps) {
  return <Tabs {...props} className={joinClassNames('styled-tabs-nav', className)} />;
}
