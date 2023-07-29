import { HomeView } from '@slack/bolt';
import { HomeTab, Section, Button, Header } from 'slack-block-builder';

export const appHomeView = (type: 'initial' | 'updated'): HomeView => {
  if (type === 'initial') {
    return HomeTab().blocks(Header().text('Welcome to Digester!')).buildToObject();
  } else {
    return HomeTab()
      .blocks(
        Header().text('Your dashboard'),
        Section()
          .text('You can add more blocks to your dashboard')
          .accessory(Button().text('Add a block').actionId('add_block'))
      )
      .buildToObject();
  }
};
