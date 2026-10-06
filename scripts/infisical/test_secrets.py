"""Verify credential transport and isolation at the actual launcher boundary."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from common import Infisical, SecretError, application_environment
import run as launcher

PROJECT = '137f4126-21ec-461b-993f-30c3162605c8'
VALUE = 'dummy-value with quotes and $HOME\nsecond line'


class SecretTests(unittest.TestCase):
    def test_transport_keeps_exact_value_off_argv(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'.infisical.json').write_text(json.dumps({'workspaceId':PROJECT}))
            client=Infisical(root)
            row={'key':'ATLAS_API_KEY','value':VALUE,'workspace':PROJECT,'secretPath':'/','type':'shared'}
            responses=[subprocess.CompletedProcess([],0,'[]',''),subprocess.CompletedProcess([],0,'',''),subprocess.CompletedProcess([],0,json.dumps([row]),'')]
            with patch('common.subprocess.run',side_effect=responses) as execute:
                client.create_and_verify('ATLAS_API_KEY',VALUE)
            args,kwargs=execute.call_args_list[1]
            self.assertNotIn(VALUE,' '.join(args[0]))
            self.assertEqual(kwargs['input'],VALUE)

    def test_missing_aliases_cannot_restore_dotenv_secrets(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'.env').write_text('ATLAS_API_KEY=dummy-stale\nATLASCLOUD_API_KEY=dummy-alias\n')
            code="const {createRequire}=await import('node:module');const req=createRequire(import.meta.url);const nextEnv=req(req.resolve('@next/env',{paths:[req.resolve('next/package.json',{paths:[process.cwd()]})]}));nextEnv.loadEnvConfig(process.argv[1],true,{info(){},error(){}});console.log(JSON.stringify({canonical:process.env.ATLAS_API_KEY,alias:process.env.ATLASCLOUD_API_KEY}));"
            result=subprocess.run(['node','--input-type=module','-e',code,folder],env=application_environment({}),capture_output=True,text=True,check=True)
            self.assertEqual(json.loads(result.stdout.splitlines()[-1]),{'canonical':'','alias':''})

    def test_manager_tokens_and_untrusted_settings_are_not_injected(self):
        with patch.dict(os.environ,{'INFISICAL_TOKEN':'dummy-manager','ATLAS_API_KEY':'dummy-stale'},clear=True):
            env=application_environment({'ATLAS_API_KEY':VALUE,'PATH':'/untrusted'})
        self.assertEqual(env['ATLAS_API_KEY'],VALUE)
        self.assertEqual(env['ATLASCLOUD_API_KEY'],'')
        self.assertNotIn('INFISICAL_TOKEN',env)
        self.assertNotIn('PATH',env)

    def test_overrides_rejected_before_fetch(self):
        with patch('run.sys.argv',['run.py','dev','--env','prod']),patch('run.Infisical') as client:
            with self.assertRaises(SecretError):launcher.main()
            client.assert_not_called()

    def test_fetch_failure_does_not_launch_app(self):
        with patch('run.sys.argv',['run.py','dev']),patch('run.Infisical') as client,patch('run.os.execvpe') as execute:
            client.return_value.read.side_effect=SecretError('fetch failed')
            with self.assertRaises(SecretError):launcher.main()
            execute.assert_not_called()

    def test_start_fetches_production_and_uses_auto_port(self):
        with patch('run.sys.argv',['run.py','start','--port','auto']),patch('run.Production') as client,patch('run.Infisical') as dev,patch('run.os.chdir'),patch('run.os.execvpe') as execute:
            client.return_value.read.return_value={'ATLAS_API_KEY':VALUE}
            launcher.main()
            dev.assert_not_called()
            args=execute.call_args.args
            self.assertEqual(args[1],['pnpm','run','start:app','--port','auto'])
            self.assertEqual(args[2]['ATLAS_API_KEY'],VALUE)


if __name__=='__main__':
    unittest.main()
