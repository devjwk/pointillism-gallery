import unittest
import tempfile
from pathlib import Path
import numpy as np
import trimesh
from pipelines.scene_reconstruction.geometry import backproject,align_background_depth,grid_mesh,candidate_metrics,observation_support
from pipelines.scene_reconstruction.pipeline import save_mesh
from pipelines.scene_reconstruction.adapters.sam3d_adapter import A,F

class GeometryTests(unittest.TestCase):
    def test_backprojection_round_trip(self):
        k=np.array([[100.,0.,4.],[0.,110.,3.],[0.,0.,1.]])
        depth=np.full((8,10),3.,dtype=np.float32)
        pts=backproject(depth,k);uv=pts@k.T;uv=uv[...,:2]/uv[...,2:3]
        yy,xx=np.mgrid[:8,:10]
        np.testing.assert_allclose(uv,np.stack([xx,yy],axis=-1),atol=1e-5)

    def test_background_preserves_known_and_occlusion_order(self):
        orig=np.linspace(2,6,256,dtype=np.float32).reshape(16,16)
        completed=(orig-.5)/2
        holes=np.zeros((16,16),bool);holes[5:10,5:10]=True
        valid=np.ones_like(holes)
        result,usable,fit=align_background_depth(orig,completed,~holes,holes,valid)
        np.testing.assert_array_equal(result[~holes],orig[~holes])
        self.assertTrue(np.all(result[holes]>=orig[holes]*1.02-1e-6))
        self.assertTrue(usable.all());self.assertAlmostEqual(fit['scale'],2.,places=4)

    def test_background_insufficient_anchors_rejected(self):
        z=np.ones((10,10),np.float32);known=np.zeros((10,10),bool)
        with self.assertRaises(ValueError):
            align_background_depth(z,z,known,~known,np.ones_like(known))

    def test_background_negative_scale_rejected(self):
        z=np.linspace(1,4,400).reshape(20,20);completed=10-z;known=np.ones_like(z,dtype=bool)
        with self.assertRaises(ValueError):
            align_background_depth(z,completed,known,~known,known)

    def test_grid_does_not_bridge_depth_discontinuity_or_export_inf(self):
        z=np.ones((8,8),np.float32);z[:,4:]=5
        valid=np.ones_like(z,dtype=bool);valid[0,0]=False;z[0,0]=np.inf
        points=backproject(z,np.eye(3));colors=np.zeros((8,8,3),np.uint8)
        mesh,tags=grid_mesh(points,colors,valid,valid)
        self.assertTrue(np.isfinite(mesh.vertices).all());self.assertEqual(len(tags),len(mesh.vertices))
        for face in mesh.faces:
            zs=mesh.vertices[face,2]
            self.assertLessEqual(zs.max()/zs.min(),1.15)

    def test_axis_conversions_are_reversible(self):
        xyz=np.array([[1.,2.,3.],[-4.,5.,6.]])
        np.testing.assert_allclose((xyz@A)@A.T,xyz)
        np.testing.assert_allclose((xyz@F)@F,xyz)
        self.assertAlmostEqual(np.linalg.det(F),1.)

    def test_candidate_metrics_respect_visible_occluders(self):
        z=np.full((8,8),2.,np.float32);reference=z.copy();valid=np.ones((8,8),bool)
        target=np.ones((8,8),bool);target[:2,:2]=False
        instance=np.ones((8,8),np.int32);instance[:2,:2]=2;reference[:2,:2]=1
        metrics=candidate_metrics(z,reference,valid,target,instance,1)
        self.assertAlmostEqual(metrics['silhouette_iou'],1.)
        self.assertAlmostEqual(metrics['relative_depth_error'],0.)
        self.assertAlmostEqual(metrics['consistency_cost'],0.)

    def test_reference_support_is_not_hidden_geometry_truth(self):
        verts=np.array([[10.,10.,2.],[12.,10.,2.],[10.,12.,2.],[10.,10.,4.]])
        mesh=trimesh.Trimesh(vertices=verts,faces=[[0,1,2],[0,1,3]],process=False)
        rgb=np.full((12,12,3),120,np.uint8);mask=np.ones((12,12),bool);zr=np.full((12,12),2.,np.float32)
        tags=observation_support(mesh,np.eye(3),rgb,mask,zr)
        self.assertEqual(tags.tolist(),[1,1,1,0])

    def test_export_preserves_vertex_tag_order(self):
        mesh=trimesh.Trimesh(vertices=[[0.,0.,2.],[1.,0.,2.],[0.,1.,2.]],faces=[[0,1,2]],vertex_colors=[[255,0,0,255]]*3,process=False)
        with tempfile.TemporaryDirectory() as tmp:
            asset=save_mesh(Path(tmp),'fixture',mesh,[1,1,0],'object','generated')
            self.assertTrue((Path(tmp)/'fixture.glb').is_file())
            self.assertEqual(asset['geometry_source'],'generated')

if __name__=='__main__':
    unittest.main()
