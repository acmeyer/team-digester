import OpenAI from 'openai';
import { Config } from '../config';

export const openAI = new OpenAI({
  apiKey: Config.OPENAI_API_KEY,
  organization: Config.OPENAI_API_ORG_ID,
});
