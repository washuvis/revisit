import { JumpFunctionParameters, JumpFunctionReturnVal } from '../../store/types';

export default function func({ answers } : JumpFunctionParameters<{name: string}>) : JumpFunctionReturnVal {
    const topAnswerLength = Object.entries(answers)
        .filter(([_, value]) => value.endTime > -1)
        .length;

    if (topAnswerLength === 5) {
        return { component: null };
    }

    return { component: 'reactComponent', parameters: { n: topAnswerLength || 0 } };
}